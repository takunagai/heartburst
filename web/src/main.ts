// ============================================================
// main.ts ─ 状態機械 + p5 インスタンスモードのスケッチ本体
//
// 元は processing/CatharsisField/CatharsisField.pde の状態機械の移植。
// Phase 9-1 で解放シーケンスをウェブ版独自に拡張した:
//
//   idle ──pointerdown──→ charging ──pointerup──→ inhale ──着弾時刻──→ impact ──ヒットストップ──→ decay ──→ idle
//                           │ level = f(保持時間, ドラッグ量)   │ 吸い込み + 無音     │ 静止・フラッシュ    │ スローモーション → 等速
//                           └─ 毎フレーム audio.chargeLevel()   └─ 着弾時刻は音響側が拍に量子化して返す
//
// 保持 < 300ms の短クリック/タップは「小破裂（pop）」の軽量パスへ分岐する。
// マウスとタッチは Pointer Events で同一パスに統合する。
// ============================================================

import p5 from "p5";

// friendly error system を無効化（本番向け）。v2 の stroke() 検証は HSB 4 引数を
// 誤検知して毎フレーム粒子数ぶんログを吐き、それ自体が fps を大きく削る
(p5 as unknown as { disableFriendlyErrors: boolean }).disableFriendlyErrors = true;
import {
  PARTICLE_COUNT,
  POP_SPARK_COUNT,
  MAX_SHOCKWAVES,
  BG_COLOR_HEX,
  CHARGE_DURATION_MS,
  DECAY_DURATION_MS,
  POP_THRESHOLD_MS,
  MIN_ORBIT_RADIUS_MAX,
  MIN_ORBIT_RADIUS_MIN,
  PULL_STRENGTH_MIN,
  PULL_STRENGTH_MAX,
  DRAG_BOOST_PER_PIXEL,
  DRAG_BOOST_MAX,
  FRICTION,
  SHAKE_DECAY,
  FLASH_DECAY,
  VIGNETTE_MAX_ALPHA,
  PARTICLE_COUNT_LEVELS,
  FPS_SAMPLE_FRAMES,
  FPS_REDUCE_THRESHOLD,
  FPS_JITTER_CV_THRESHOLD,
  FRAME_TIME_OUTLIER_MS,
  INHALE_PULL_MUL,
  INHALE_MIN_ORBIT,
  HITSTOP_MS_MIN,
  HITSTOP_MS_MAX,
  SLOWMO_TIME_SCALE,
  SLOWMO_RECOVER_MS,
  FLASH_ALPHA_MIN,
  FLASH_ALPHA_MAX,
  ZOOM_INHALE,
  ZOOM_IMPACT_KICK,
  ZOOM_SPRING,
  ZOOM_DAMPING,
  GLOW_DOWNSCALE,
  GLOW_BLUR_PX,
  GLOW_OPACITY_IDLE,
  GLOW_OPACITY_PEAK,
} from "./tuning";
import { Particle, Shockwave, buildVignette } from "./visuals";
import type { SimState, FrameParams } from "./visuals";
import { createAudioEngine } from "./audio/engine";

const audio = createAudioEngine();
// チューニング・検証用に露出（本番でも害はない読み取り専用ハンドル）
(window as unknown as { __catharsisAudio: unknown }).__catharsisAudio = audio;

// AGPLv3（web/LICENSE）ソース公開の表記。リポジトリ URL は Phase 5 の公開時に確定
console.info("CatharsisField ─ licensed under AGPLv3. source: TBD");

// ---- 状態機械 ----

let state: SimState = "idle";

let chargeStartMillis = 0;
let level = 0;
let dragBoost = 0;

// 解放シーケンス（inhale 以降は解放時の値で固定）
let releaseLevel = 0;
let releaseX = 0;
let releaseY = 0;
let impactAtMillis = 0;
let hitstopEndMillis = 0;
let decayDurationMs = DECAY_DURATION_MS;

let energy = 0;
let decayStartMillis = 0;
let timeScale = 1;

// 演出用の状態
let flashAlpha = 0;
let coreFlash = 0; // 爆心の白い核（0..1）
let shakeIntensity = 0;
let shakeX = 0;
let shakeY = 0;

// カメラ（ばねで追従するズーム。中心は溜め中はポインタ、解放後は爆心）
let zoom = 1;
let zoomVelocity = 0;
let zoomCenterX = 0;
let zoomCenterY = 0;

// 粒子・衝撃波（配列使い回し。毎フレームの生成は行わない）
let particles: Particle[] = [];
let shockwaves: Shockwave[] = [];
let popSparkCursor = 0;

// 粒子ループに渡すフレーム不変値（毎フレーム中身だけ書き換える）
const frameParams: FrameParams = {
  state: "idle",
  level: 0,
  energy: 0,
  attractorX: 0,
  attractorY: 0,
  minOrbit: MIN_ORBIT_RADIUS_MAX,
  pullStrength: PULL_STRENGTH_MIN,
  timeScale: 1,
  friction: FRICTION,
  amp: 0,
  width: 0,
  height: 0,
};

// 背景色の HSB 分解（起動時 1 回）
let bgHue = 0;
let bgSat = 0;
let bgBri = 0;

let vignetteImg: p5.Image;

// グロー: 縮小キャンバスへ本体をぼかして写し、CSS で拡大 + screen 合成で重ねる。
// 本体キャンバスへ加算し直すとトレイルと帰還ループを作って白飽和するため、別レイヤーにする
let glowCanvas: HTMLCanvasElement;
let glowCtx: CanvasRenderingContext2D;
let glowOpacity = -1;

// ポインタ位置（マウス/タッチ共通）。attractorPos 相当
let pointerX = 0;
let pointerY = 0;
let prevPointerX = 0;
let prevPointerY = 0;
let isPointerDown = false;

// ---- デバッグ HUD ----
let showHud = false;
let drawMsAverage = 0; // draw 1 回の処理時間の指数移動平均（rAF 制限と真の負荷を区別するための計測値）

// ---- 粒子数の自動調整（起動後 FPS_SAMPLE_FRAMES フレームの実測 fps で判定）----
let particleLevelIndex = 0;
let perfFrameTimes: number[] = [];
let isMeasuringPerf = true;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalize(x: number, y: number, w: number, h: number): [number, number] {
  return [x / w, y / h];
}

// ---- 状態機械の更新 ----

function updateState(p: p5): void {
  const now = p.millis();
  if (state === "charging") {
    updateCharging(now);
  } else if (state === "inhale") {
    if (now >= impactAtMillis) triggerImpact(now);
  } else if (state === "impact") {
    if (now >= hitstopEndMillis) {
      state = "decay";
      decayStartMillis = now;
    }
  } else if (state === "decay") {
    updateDecay(now);
  }
}

function updateCharging(now: number): void {
  const heldMs = now - chargeStartMillis;
  const t = Math.min(Math.max(heldMs / CHARGE_DURATION_MS, 0), 1);
  level = Math.min(Math.max(easeOutQuad(t) + dragBoost, 0), 1);
  audio.chargeLevel(level);
}

function updateDecay(now: number): void {
  const elapsed = now - decayStartMillis;
  energy = Math.min(Math.max(1.0 - elapsed / decayDurationMs, 0), 1);
  audio.setEnergy(energy);

  // スローモーション: 強い解放ほど遅く始まり、SLOWMO_RECOVER_MS かけて等速へ
  const slowStart = lerp(1, SLOWMO_TIME_SCALE, releaseLevel);
  timeScale = lerp(slowStart, 1, easeInOutQuad(Math.min(elapsed / SLOWMO_RECOVER_MS, 1)));

  if (energy <= 0) {
    state = "idle";
    level = 0;
    timeScale = 1;
  }
}

function updateShake(p: p5): void {
  if (shakeIntensity > 0.05) {
    shakeX = p.random(-shakeIntensity, shakeIntensity);
    shakeY = p.random(-shakeIntensity, shakeIntensity);
    shakeIntensity *= SHAKE_DECAY;
  } else {
    shakeX = 0;
    shakeY = 0;
    shakeIntensity = 0;
  }
}

function updateCamera(): void {
  let target = 1;
  if (state === "charging") {
    target = 1 + ZOOM_INHALE * 0.35 * level; // 溜め中はじわりと寄る
    zoomCenterX = pointerX;
    zoomCenterY = pointerY;
  } else if (state === "inhale") {
    target = 1 + ZOOM_INHALE * releaseLevel;
  }
  zoomVelocity += (target - zoom) * ZOOM_SPRING;
  zoomVelocity *= ZOOM_DAMPING;
  zoom += zoomVelocity;
}

// ---- 粒子数の自動調整 ----
//
// p.deltaTime（前フレームからの経過 ms）を FPS_SAMPLE_FRAMES 個貯め、
// 平均 fps としきい値を比較する。しきい値未満でも「間隔が一定」なら
// 省エネモード等による rAF 制限とみなし間引かない（変動係数で判定）。
// 実際に重いと判定した場合のみ PARTICLE_COUNT_LEVELS の次段へ配列を
// 切り詰め、まだ下段が残っていれば次の FPS_SAMPLE_FRAMES で再評価する。
function updatePerfAutoScale(p: p5): void {
  if (!isMeasuringPerf) return;

  // 最初のフレームは millis() 起点のブレが大きいので計測対象から除外
  if (p.frameCount <= 1) return;

  const dt = p.deltaTime;
  if (dt > FRAME_TIME_OUTLIER_MS) {
    // タブ切り替え復帰等の外れ値混入。実際の重さと無関係なので今回の計測は打ち切る
    isMeasuringPerf = false;
    return;
  }

  perfFrameTimes.push(dt);
  if (perfFrameTimes.length < FPS_SAMPLE_FRAMES) return;

  const mean = perfFrameTimes.reduce((sum, v) => sum + v, 0) / perfFrameTimes.length;
  const variance = perfFrameTimes.reduce((sum, v) => sum + (v - mean) ** 2, 0) / perfFrameTimes.length;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const meanFps = mean > 0 ? 1000 / mean : 60;

  perfFrameTimes = [];

  if (meanFps >= FPS_REDUCE_THRESHOLD) {
    isMeasuringPerf = false; // 十分な fps ─ 以後の計測は不要
    return;
  }

  if (coefficientOfVariation < FPS_JITTER_CV_THRESHOLD) {
    isMeasuringPerf = false; // 間隔が一定 ─ rAF 自体の周波数制限とみなし間引かない
    return;
  }

  const nextIndex = particleLevelIndex + 1;
  if (nextIndex >= PARTICLE_COUNT_LEVELS.length) {
    isMeasuringPerf = false; // 最下段まで到達済み
    return;
  }

  particleLevelIndex = nextIndex;
  particles.length = PARTICLE_COUNT_LEVELS[nextIndex]; // 削減のみ。切り詰めるだけでよい
  console.info(
    `[perf] fps=${meanFps.toFixed(1)} cv=${coefficientOfVariation.toFixed(2)} → 粒子数を ${PARTICLE_COUNT_LEVELS[nextIndex]} に削減`,
  );

  if (nextIndex >= PARTICLE_COUNT_LEVELS.length - 1) {
    isMeasuringPerf = false; // これ以上削減できないので打ち切り
  }
  // まだ下段があれば isMeasuringPerf は true のまま次の FPS_SAMPLE_FRAMES で再評価する
}

// ---- 演出トリガー ----

// 解放: 音響に着弾時刻を決めさせ、それまで吸い込み（inhale）で待つ
function beginRelease(p: p5, nx: number, ny: number): void {
  releaseLevel = level;
  releaseX = pointerX;
  releaseY = pointerY;
  zoomCenterX = releaseX;
  zoomCenterY = releaseY;

  const timing = audio.release(releaseLevel, nx, ny);
  impactAtMillis = p.millis() + timing.impactDelaySec * 1000;
  decayDurationMs = Math.max(DECAY_DURATION_MS, timing.dropSec * 1000);
  state = "inhale";
}

// 着弾: 物理を止めた 1 枚絵（ヒットストップ）を作ってから decay へ
function triggerImpact(now: number): void {
  energy = 1.0;
  timeScale = 0;

  for (const particle of particles) {
    particle.applyImpulse(releaseX, releaseY, releaseLevel);
  }

  spawnShockwave(releaseX, releaseY, releaseLevel, "lead");
  spawnShockwave(releaseX, releaseY, releaseLevel, "main");
  spawnShockwave(releaseX, releaseY, releaseLevel, "echo");

  flashAlpha = lerp(FLASH_ALPHA_MIN, FLASH_ALPHA_MAX, releaseLevel);
  coreFlash = 1;
  shakeIntensity = lerp(4, 40, releaseLevel);
  zoomVelocity = ZOOM_IMPACT_KICK * (0.4 + 0.6 * releaseLevel);

  hitstopEndMillis = now + lerp(HITSTOP_MS_MIN, HITSTOP_MS_MAX, releaseLevel);
  state = "impact";
}

function triggerPop(px: number, py: number, nx: number, ny: number): void {
  // particles.length を使う（PARTICLE_COUNT 固定値ではない）─
  // 自動調整で配列が切り詰められた後も範囲外アクセスにならないように
  for (let i = 0; i < POP_SPARK_COUNT; i++) {
    const idx = (popSparkCursor + i) % particles.length;
    particles[idx].popSpark(px, py);
  }
  popSparkCursor = (popSparkCursor + POP_SPARK_COUNT) % particles.length;

  audio.pop(nx, ny);
}

function spawnShockwave(px: number, py: number, waveLevel: number, kind: "lead" | "main" | "echo"): void {
  // 非活性の個体を探して再利用。全部活性中なら最も薄い個体を上書き
  let target = shockwaves[0];
  for (const wave of shockwaves) {
    if (!wave.active) {
      target = wave;
      break;
    }
    if (wave.alphaVal < target.alphaVal) target = wave;
  }
  target.start(px, py, waveLevel, kind);
}

// ---- ポインタ入力（マウス/タッチを Pointer Events で同一パスに統合）----

function handlePointerDown(p: p5, clientX: number, clientY: number): void {
  // inhale / impact 中は受け付けない（着弾演出を途中で壊さない）
  if (state !== "idle" && state !== "decay") return;

  state = "charging";
  chargeStartMillis = p.millis();
  level = 0;
  dragBoost = 0;
  timeScale = 1;

  pointerX = clientX;
  pointerY = clientY;
  prevPointerX = clientX;
  prevPointerY = clientY;
  isPointerDown = true;

  const [nx, ny] = normalize(clientX, clientY, p.width, p.height);
  audio.chargeStart(nx, ny);
}

function handlePointerMove(clientX: number, clientY: number): void {
  pointerX = clientX;
  pointerY = clientY;

  if (state === "charging" && isPointerDown) {
    const d = Math.hypot(pointerX - prevPointerX, pointerY - prevPointerY);
    dragBoost = Math.min(dragBoost + d * DRAG_BOOST_PER_PIXEL, DRAG_BOOST_MAX);
  }

  prevPointerX = pointerX;
  prevPointerY = pointerY;
}

function handlePointerUp(p: p5): void {
  isPointerDown = false;
  if (state !== "charging") return;

  const heldMs = p.millis() - chargeStartMillis;
  const [nx, ny] = normalize(pointerX, pointerY, p.width, p.height);

  if (heldMs < POP_THRESHOLD_MS) {
    triggerPop(pointerX, pointerY, nx, ny);
    state = "idle";
  } else {
    beginRelease(p, nx, ny);
  }
}

// ---- 導入オーバーレイ（初回 pointerdown で AudioContext を起動しつつ
// そのまま 1 回目のチャージへ繋げる）----

function initOverlayGate(p: p5): void {
  const overlay = document.getElementById("overlay");
  if (!overlay) return;

  const onFirstPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    overlay.removeEventListener("pointerdown", onFirstPointerDown);
    overlay.classList.add("overlay--hidden");

    void audio.start().then(() => {
      handlePointerDown(p, event.clientX, event.clientY);
    });

    window.setTimeout(() => overlay.remove(), 500); // トランジション終了後に DOM から除去
  };

  overlay.addEventListener("pointerdown", onFirstPointerDown, { passive: false });
}

// ---- グロー ----

function createGlowLayer(container: HTMLElement): void {
  glowCanvas = document.createElement("canvas");
  glowCanvas.id = "glow-layer";
  glowCanvas.setAttribute("aria-hidden", "true");
  container.appendChild(glowCanvas);
  const context = glowCanvas.getContext("2d");
  if (!context) throw new Error("グローレイヤーの 2D context を取得できません");
  glowCtx = context;
  resizeGlowLayer();
}

function resizeGlowLayer(): void {
  glowCanvas.width = Math.ceil(window.innerWidth / GLOW_DOWNSCALE);
  glowCanvas.height = Math.ceil(window.innerHeight / GLOW_DOWNSCALE);
}

function updateGlow(source: HTMLCanvasElement): void {
  const w = glowCanvas.width;
  const h = glowCanvas.height;
  glowCtx.clearRect(0, 0, w, h);
  // ctx.filter 非対応環境では無視され、縮小・拡大の補間ぼけだけが残る（それでもグローとして成立する）
  glowCtx.filter = `blur(${GLOW_BLUR_PX}px)`;
  glowCtx.drawImage(source, 0, 0, w, h);
  glowCtx.filter = "none";

  let intensity = 0;
  if (state === "charging") intensity = level;
  else if (state === "inhale" || state === "impact") intensity = 1;
  else if (state === "decay") intensity = energy;
  const opacity = Math.round(lerp(GLOW_OPACITY_IDLE, GLOW_OPACITY_PEAK, intensity) * 50) / 50;
  if (opacity !== glowOpacity) {
    glowOpacity = opacity;
    glowCanvas.style.opacity = String(opacity);
  }
}

// ---- デバッグ HUD ----

function drawHud(p: p5): void {
  p.fill(0, 0, 100, 100);
  p.textSize(13);
  p.text(`fps: ${p.frameRate().toFixed(1)}`, 12, 20);
  p.text(`state: ${state}`, 12, 38);
  p.text(`level: ${level.toFixed(2)}  energy: ${energy.toFixed(2)}  timeScale: ${timeScale.toFixed(2)}`, 12, 56);
  p.text(`particles: ${particles.length}  draw: ${drawMsAverage.toFixed(1)}ms`, 12, 74);
}

// ---- p5 インスタンスモード スケッチ本体 ----

const sketch = (p: p5) => {
  p.setup = () => {
    const canvasRenderer = p.createCanvas(window.innerWidth, window.innerHeight);
    p.pixelDensity(1); // retina の高密度ピクセルを回避（p5 v2 では createCanvas の後に呼ばないと効かない）
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.frameRate(60);
    p.background(BG_COLOR_HEX);
    p.noStroke();

    const bg = p.color(BG_COLOR_HEX);
    bgHue = p.hue(bg);
    bgSat = p.saturation(bg);
    bgBri = p.brightness(bg);

    particles = Array.from({ length: PARTICLE_COUNT }, () => new Particle(p));
    shockwaves = Array.from({ length: MAX_SHOCKWAVES }, () => new Shockwave(p));

    vignetteImg = buildVignette(p, p.width, p.height);
    createGlowLayer(canvasRenderer.elt.parentElement as HTMLElement);

    pointerX = p.width / 2;
    pointerY = p.height / 2;
    prevPointerX = pointerX;
    prevPointerY = pointerY;

    canvasRenderer.elt.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        event.preventDefault();
        handlePointerDown(p, event.clientX, event.clientY);
      },
      { passive: false },
    );
    window.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        handlePointerMove(event.clientX, event.clientY);
      },
      { passive: false },
    );
    window.addEventListener("pointerup", () => handlePointerUp(p), { passive: false });
    window.addEventListener("pointercancel", () => handlePointerUp(p), { passive: false });

    initOverlayGate(p);

    // 検証用の読み取り専用スナップショット（E2E で状態遷移・スローモーションを数値確認する）
    (window as unknown as { __catharsisDebug: () => object }).__catharsisDebug = () => ({
      state,
      level,
      releaseLevel,
      energy,
      timeScale,
      zoom,
      flashAlpha,
      particles: particles.length,
      drawMs: drawMsAverage,
    });
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    vignetteImg = buildVignette(p, p.width, p.height);
    resizeGlowLayer();
  };

  p.draw = () => {
    const drawStart = performance.now();
    updatePerfAutoScale(p);
    updateState(p);
    updateShake(p);
    updateCamera();

    // 背景をごく薄く重ねて軌跡（トレイル）を残す。カメラ変換の外（画面座標）で全面に掛ける
    p.blendMode(p.BLEND);
    p.noStroke();
    p.fill(bgHue, bgSat, bgBri, 55);
    p.rect(0, 0, p.width, p.height);

    p.push();
    p.translate(shakeX, shakeY);
    p.translate(zoomCenterX, zoomCenterY);
    p.scale(zoom);
    p.translate(-zoomCenterX, -zoomCenterY);

    p.blendMode(p.ADD);

    // 粒子ループの不変値はフレームごとに 1 回だけ算出
    const f = frameParams;
    f.state = state;
    f.energy = energy;
    f.timeScale = timeScale;
    f.friction = Math.pow(FRICTION, timeScale);
    f.amp = audio.getAmp(); // analyser 読み出しは 1 フレーム 1 回
    f.width = p.width;
    f.height = p.height;
    if (state === "charging") {
      f.level = level;
      f.attractorX = pointerX;
      f.attractorY = pointerY;
      f.minOrbit = lerp(MIN_ORBIT_RADIUS_MAX, MIN_ORBIT_RADIUS_MIN, level);
      f.pullStrength = lerp(PULL_STRENGTH_MIN, PULL_STRENGTH_MAX, level);
    } else if (state === "inhale") {
      f.level = releaseLevel;
      f.attractorX = releaseX;
      f.attractorY = releaseY;
      f.minOrbit = INHALE_MIN_ORBIT;
      f.pullStrength = PULL_STRENGTH_MAX * INHALE_PULL_MUL;
    } else {
      f.level = releaseLevel;
    }
    Particle.advanceFlowPhase();

    const pushers = state === "decay" ? shockwaves.filter((wave) => wave.isPushing) : [];
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    ctx.lineCap = "round";
    for (const particle of particles) {
      particle.update(f);
      for (const wave of pushers) wave.pushParticle(particle);
      particle.display(ctx, f);
    }

    for (const wave of shockwaves) {
      wave.update(timeScale);
      wave.display();
    }

    // 爆心の白い核: ヒットストップ中は最大、明けてから広がりながら消える
    if (coreFlash > 0.02) {
      const radius = lerp(30, 120, releaseLevel) * (1 + (1 - coreFlash) * 2.5);
      p.noStroke();
      p.fill(0, 0, 100, coreFlash * 85);
      p.circle(releaseX, releaseY, radius * 2);
      if (state !== "impact") coreFlash *= 0.8;
    } else {
      coreFlash = 0;
    }

    p.pop();

    p.blendMode(p.BLEND);
    updateGlow(p.drawingContext.canvas as HTMLCanvasElement);

    // 溜め〜吸い込み中は画面端をヴィネットで暗くする（level に応じて濃くなる）
    const vignetteLevel = state === "charging" ? level : state === "inhale" ? releaseLevel : 0;
    if (vignetteLevel > 0.001) {
      p.push();
      p.colorMode(p.RGB, 255);
      p.tint(255, vignetteLevel * VIGNETTE_MAX_ALPHA);
      p.image(vignetteImg, 0, 0);
      p.noTint();
      p.pop();
    }

    // フラッシュは画面全体に BLEND で重ねる（ADD だと白飽和が消えにくい）
    if (flashAlpha > 0.5) {
      p.noStroke();
      p.fill(0, 0, 100, flashAlpha);
      p.rect(0, 0, p.width, p.height);
    }
    // ヒットストップ中はフラッシュを保持し、明けてから急減衰させる
    if (state !== "impact") {
      flashAlpha *= FLASH_DECAY;
      if (flashAlpha < 0.5) flashAlpha = 0;
    }

    drawMsAverage += (performance.now() - drawStart - drawMsAverage) * 0.1;
    if (showHud) drawHud(p);

    // パフォーマンス計測（統合検証用。120 フレームごとに fps をログへ）
    if (p.frameCount % 120 === 0) {
      console.log(`[perf] fps=${p.frameRate().toFixed(1)} state=${state}`);
    }
  };

  p.keyPressed = () => {
    if (p.key === "d" || p.key === "D") {
      showHud = !showHud;
    }
  };
};

const container = document.getElementById("sketch-container");
if (!container) {
  throw new Error("sketch-container 要素が見つかりません（index.html を確認してください）");
}

new p5(sketch, container);
