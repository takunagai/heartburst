// ============================================================
// main.ts ─ 状態機械 + p5 インスタンスモードのスケッチ本体
//
// processing/CatharsisField/CatharsisField.pde の状態機械を 1:1 移植。
// OSC は廃止し、同一ページ内の関数呼び出し（AudioEngine）に置き換えている。
//
//   idle ──pointerdown──→ charging ──pointerup──→ releasing ──(1frame)──→ decay ──(約3秒)──→ idle
//                            │ level = f(保持時間, ドラッグ量) ∈ [0,1]
//                            └─ 毎フレーム audio.chargeLevel(level) を呼ぶ
//                              （ネイティブ版の 30Hz OSC スロットルは廃止。
//                                同一プロセス内の直接呼び出しなので帯域制約が無いため）
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
  SHAKE_DECAY,
  FLASH_DECAY,
  VIGNETTE_MAX_ALPHA,
  PARTICLE_COUNT_LEVELS,
  FPS_SAMPLE_FRAMES,
  FPS_REDUCE_THRESHOLD,
  FPS_JITTER_CV_THRESHOLD,
  FRAME_TIME_OUTLIER_MS,
} from "./tuning";
import { Particle, Shockwave, buildVignette } from "./visuals";
import type { SimState } from "./visuals";
import { createAudioEngine } from "./audio/engine";

const audio = createAudioEngine();
// チューニング・検証用に露出（本番でも害はない読み取り専用ハンドル）
(window as unknown as { __catharsisAudio: unknown }).__catharsisAudio = audio;

// AGPLv3（web/LICENSE）ソース公開の表記。リポジトリ URL は Phase 5 の公開時に確定
console.info("CatharsisField ─ licensed under AGPLv3. source: TBD");

// ---- 状態機械（CatharsisField.pde の STATE_* に対応）----

let state: SimState = "idle";

let chargeStartMillis = 0;
let level = 0;
let dragBoost = 0;

let energy = 0;
let decayStartMillis = 0;

// 演出用の状態
let flashAlpha = 0;
let shakeIntensity = 0;
let shakeX = 0;
let shakeY = 0;

// 粒子・衝撃波（配列使い回し。毎フレームの生成は行わない）
let particles: Particle[] = [];
let shockwaves: Shockwave[] = [];
let popSparkCursor = 0;

// フレーム不変値のキャッシュ（粒子ループを PARTICLE_COUNT 回まわす中で再計算しない）
let frameMinOrbit = MIN_ORBIT_RADIUS_MAX;
let framePullStrength = PULL_STRENGTH_MIN;

// 背景色の HSB 分解（起動時 1 回）
let bgHue = 0;
let bgSat = 0;
let bgBri = 0;

let vignetteImg: p5.Image;

// ポインタ位置（マウス/タッチ共通）。attractorPos 相当
let pointerX = 0;
let pointerY = 0;
let prevPointerX = 0;
let prevPointerY = 0;
let isPointerDown = false;

// ---- デバッグ HUD ----
let showHud = false;

// ---- 粒子数の自動調整（起動後 FPS_SAMPLE_FRAMES フレームの実測 fps で判定）----
let particleLevelIndex = 0;
let perfFrameTimes: number[] = [];
let isMeasuringPerf = true;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function normalize(x: number, y: number, w: number, h: number): [number, number] {
  return [x / w, y / h];
}

// ---- 状態機械の更新 ----

function updateState(p: p5): void {
  if (state === "charging") {
    updateCharging(p);
  } else if (state === "releasing") {
    // release 演出は trigger 時に単発発火済み。1 フレームだけ経由して decay へ
    state = "decay";
  } else if (state === "decay") {
    updateDecay(p);
  }
}

function updateCharging(p: p5): void {
  const heldMs = p.millis() - chargeStartMillis;
  const t = p.constrain(heldMs / CHARGE_DURATION_MS, 0, 1);
  const eased = easeOutQuad(t);
  level = p.constrain(eased + dragBoost, 0, 1);
  audio.chargeLevel(level);
}

function updateDecay(p: p5): void {
  const elapsed = p.millis() - decayStartMillis;
  energy = p.constrain(1.0 - elapsed / DECAY_DURATION_MS, 0, 1);
  audio.setEnergy(energy);

  if (energy <= 0) {
    state = "idle";
    level = 0;
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

function triggerRelease(p: p5, px: number, py: number, releaseLevel: number, nx: number, ny: number): void {
  energy = 1.0;
  decayStartMillis = p.millis();

  for (const particle of particles) {
    particle.applyImpulse(px, py, releaseLevel);
  }

  spawnShockwave(px, py, releaseLevel);

  flashAlpha = 100; // colorMode の alpha レンジは 100
  shakeIntensity = p.lerp(4, 40, releaseLevel);

  audio.release(releaseLevel, nx, ny);
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

function spawnShockwave(px: number, py: number, waveLevel: number): void {
  // 非活性の個体を探して再利用。全部活性中なら先頭を上書き
  for (const wave of shockwaves) {
    if (!wave.active) {
      wave.start(px, py, waveLevel);
      return;
    }
  }
  shockwaves[0].start(px, py, waveLevel);
}

// ---- ポインタ入力（マウス/タッチを Pointer Events で同一パスに統合）----

function handlePointerDown(p: p5, clientX: number, clientY: number): void {
  if (state === "idle" || state === "decay") {
    state = "charging";
    chargeStartMillis = p.millis();
    level = 0;
    dragBoost = 0;

    pointerX = clientX;
    pointerY = clientY;
    prevPointerX = clientX;
    prevPointerY = clientY;
    isPointerDown = true;

    const [nx, ny] = normalize(clientX, clientY, p.width, p.height);
    audio.chargeStart(nx, ny);
  }
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
    triggerRelease(p, pointerX, pointerY, level, nx, ny);
    state = "releasing";
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

// ---- デバッグ HUD ----

function drawHud(p: p5): void {
  p.fill(0, 0, 100, 100);
  p.textSize(13);
  p.text(`fps: ${p.frameRate().toFixed(1)}`, 12, 20);
  p.text(`state: ${state}`, 12, 38);
  p.text(`level: ${level.toFixed(2)}  energy: ${energy.toFixed(2)}`, 12, 56);
  p.text(`particles: ${particles.length}`, 12, 74);
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
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    vignetteImg = buildVignette(p, p.width, p.height);
  };

  p.draw = () => {
    updatePerfAutoScale(p);
    updateState(p);
    updateShake(p);

    p.push();
    p.translate(shakeX, shakeY);

    // 背景をごく薄く重ねて軌跡（トレイル）を残す。ADD 合成前に BLEND で行う
    p.blendMode(p.BLEND);
    p.noStroke();
    p.fill(bgHue, bgSat, bgBri, 55);
    p.rect(-40, -40, p.width + 80, p.height + 80);

    p.blendMode(p.ADD);

    // 粒子ループの不変値はフレームごとに 1 回だけ算出
    if (state === "charging") {
      frameMinOrbit = p.lerp(MIN_ORBIT_RADIUS_MAX, MIN_ORBIT_RADIUS_MIN, level);
      framePullStrength = p.lerp(PULL_STRENGTH_MIN, PULL_STRENGTH_MAX, level);
    }
    Particle.advanceFlowPhase();
    const frameAmp = audio.getAmp(); // analyser 読み出しは 1 フレーム 1 回

    for (const particle of particles) {
      particle.update(state, level, pointerX, pointerY, frameMinOrbit, framePullStrength);
      particle.display(state, level, frameAmp);
    }

    for (const wave of shockwaves) {
      wave.update();
      wave.display();
    }

    p.pop();

    p.blendMode(p.BLEND);

    // charging 中は画面端をヴィネットで暗くする（level に応じて濃くなる）
    if (state === "charging" && level > 0.001) {
      p.push();
      p.colorMode(p.RGB, 255);
      p.tint(255, level * VIGNETTE_MAX_ALPHA);
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
    // 減衰は描画後に行う（release 直後の初回フレームを満輝度で見せるため。描画順に依存する点は意図的）
    flashAlpha *= FLASH_DECAY;
    if (flashAlpha < 0.5) flashAlpha = 0;

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
