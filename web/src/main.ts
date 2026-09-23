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
// Phase 9-2（溜めのドラマとゲーム性）:
//   - 段階チャージ: 33/66/100% で輪・和音・揺れ。溜め中はポインタに進行の円弧と心拍の脈動を描く
//   - オーバーチャージ: 満充填後も保持すると赤熱・Shepard トーン・揺れが増し、満了で暴発（overload）
//   - クリティカル: 心拍の頂点付近で離すと金の爆発（critical）
//   - スリングショット: 離す直前の弾き速度で爆発に向きが付く
//   - idle の粒子はカーソルを避ける / スマホは振って解放・振動フィードバック
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
  CHARGE_TIERS,
  TIER_SWIRL,
  CHARGE_RING_RADIUS,
  OVERCHARGE_MS,
  OVERCHARGE_POWER_BONUS,
  OVERCHARGE_SHAKE,
  OVERCHARGE_HUE,
  CRITICAL_MIN_LEVEL,
  CRITICAL_WINDOW,
  CRITICAL_POWER_BONUS,
  CRITICAL_HUE,
  SLINGSHOT_MIN_SPEED,
  SLINGSHOT_MAX_SPEED,
  SLINGSHOT_SAMPLE_MS,
  SHAKE_RELEASE_ACCEL,
} from "./tuning";
import { Particle, Shockwave, buildVignette } from "./visuals";
import type { SimState, FrameParams } from "./visuals";
import { createAudioEngine } from "./audio/engine";
import type { BurstStyle } from "./audio/engine";

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
let releasePower = 0;
let releaseStyle: BurstStyle = "normal";
let releaseDirX = 0;
let releaseDirY = 0;
let releaseDirAmount = 0;

// ドロップ中の拍の検出（振幅の立ち上がり）→ 爆心から輪を出して画面を拍に乗せる
let ampSmoothed = 0;
let lastBeatPulseMillis = 0;

// 二次爆発（花火の連鎖）: 着弾後、爆心の周りで時間差に弾ける
interface SecondaryBurst {
  atMillis: number;
  x: number;
  y: number;
  intensity: number;
  hue: number;
}
const secondaryBursts: SecondaryBurst[] = [];
const SECONDARY_SPARK_COUNT = 70;

// 溜めのドラマ（段階・オーバーチャージ）
let currentTier = 0;
let fullChargeAtMillis = -1;
let overchargeAmount = 0;
let lastOverchargeBuzzMillis = 0;

let energy = 0;
let decayStartMillis = 0;
let timeScale = 1;

// 演出用の状態
let flashAlpha = 0;
let flashHue = 0;
let flashSat = 0;
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
  swirl: 0,
  overcharge: 0,
  isHovering: false,
  hoverX: 0,
  hoverY: 0,
  burstStyle: "normal",
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
// 直近のポインタ軌跡（スリングショットの弾き速度の算出用）
const pointerSamples: { t: number; x: number; y: number }[] = [];
let lastHoverMoveMillis = Number.NEGATIVE_INFINITY; // マウスのホバー移動（タッチには無い）

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

// 振動フィードバック（Android Chrome のみ。iOS Safari は navigator.vibrate 非対応なので黙って無視）
function vibrate(pattern: number | number[]): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

// ---- 状態機械の更新 ----

function updateState(p: p5): void {
  const now = p.millis();
  if (state === "charging") {
    updateCharging(p, now);
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

function updateCharging(p: p5, now: number): void {
  const heldMs = now - chargeStartMillis;
  const t = Math.min(Math.max(heldMs / CHARGE_DURATION_MS, 0), 1);
  level = Math.min(Math.max(easeOutQuad(t) + dragBoost, 0), 1);
  audio.chargeLevel(level);

  const tier = CHARGE_TIERS.filter((threshold) => level >= threshold - 1e-6).length;
  if (tier > currentTier) {
    currentTier = tier;
    onTierUp(tier);
  }

  // オーバーチャージ: 満充填からの保持時間。満了で暴発
  if (level >= 1) {
    if (fullChargeAtMillis < 0) fullChargeAtMillis = now;
    overchargeAmount = Math.min((now - fullChargeAtMillis) / OVERCHARGE_MS, 1);
  } else {
    fullChargeAtMillis = -1;
    overchargeAmount = 0;
  }
  audio.overcharge(overchargeAmount);
  if (overchargeAmount > 0) {
    shakeIntensity = Math.max(shakeIntensity, overchargeAmount * OVERCHARGE_SHAKE);
    // 振動の間隔を詰めていく（鼓動が速まる感覚）
    if (now - lastOverchargeBuzzMillis > lerp(320, 90, overchargeAmount)) {
      lastOverchargeBuzzMillis = now;
      vibrate(12);
    }
    if (overchargeAmount >= 1) {
      const [nx, ny] = normalize(pointerX, pointerY, p.width, p.height);
      beginRelease(p, nx, ny, "overload");
    }
  }
}

const TIER_RING_COLORS: [number, number][] = [
  [190, 70], // シアン
  [318, 75], // マゼンタ
  [0, 0], // 白
];

function onTierUp(tier: number): void {
  audio.tierUp(tier);
  const [hue, sat] = TIER_RING_COLORS[tier - 1];
  spawnShockwave(pointerX, pointerY, tier / 3, "tier", hue, sat);
  shakeIntensity = Math.max(shakeIntensity, 2 + tier * 2.5);
  flashAlpha = Math.max(flashAlpha, 4 + tier * 3);
  flashHue = hue;
  flashSat = sat * 0.5;
  zoomVelocity += 0.012 * tier;
  vibrate(10 + tier * 12);
}

function updateDecay(now: number): void {
  const elapsed = now - decayStartMillis;
  energy = Math.min(Math.max(1.0 - elapsed / decayDurationMs, 0), 1);
  audio.setEnergy(energy);

  // スローモーション: 強い解放ほど遅く始まり、SLOWMO_RECOVER_MS かけて等速へ（特殊な爆発はさらに深く）
  const slowStart = lerp(1, SLOWMO_TIME_SCALE * (releaseStyle === "normal" ? 1 : 0.7), Math.min(releasePower, 1));
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

// 離す直前の弾き速度（px/ms）と向き
function measureFlick(now: number): { dirX: number; dirY: number; amount: number } {
  const recent = pointerSamples.filter((sample) => now - sample.t <= SLINGSHOT_SAMPLE_MS);
  if (recent.length < 2) return { dirX: 0, dirY: 0, amount: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = Math.max(last.t - first.t, 1);
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const speed = Math.hypot(dx, dy) / dt;
  if (speed < SLINGSHOT_MIN_SPEED) return { dirX: 0, dirY: 0, amount: 0 };
  const amount = Math.min((speed - SLINGSHOT_MIN_SPEED) / (SLINGSHOT_MAX_SPEED - SLINGSHOT_MIN_SPEED), 1);
  const length = Math.hypot(dx, dy);
  return { dirX: dx / length, dirY: dy / length, amount: 0.35 + 0.65 * amount };
}

// 解放: 爆発の種類と威力を決め、音響に着弾時刻を決めさせ、それまで吸い込み（inhale）で待つ
function beginRelease(
  p: p5,
  nx: number,
  ny: number,
  forcedStyle?: BurstStyle,
  forcedDirection?: { dirX: number; dirY: number; amount: number },
): void {
  releaseLevel = level;
  releaseX = pointerX;
  releaseY = pointerY;
  zoomCenterX = releaseX;
  zoomCenterY = releaseY;

  const phase = audio.getHeartbeatPhase();
  const isOnBeat = phase <= CRITICAL_WINDOW || phase >= 1 - CRITICAL_WINDOW;
  releaseStyle = forcedStyle ?? (level >= CRITICAL_MIN_LEVEL && isOnBeat ? "critical" : "normal");
  releasePower =
    level + overchargeAmount * OVERCHARGE_POWER_BONUS + (releaseStyle === "critical" ? CRITICAL_POWER_BONUS : 0);
  if (releaseStyle === "overload") releasePower = 1 + OVERCHARGE_POWER_BONUS;

  const flick = forcedDirection ?? measureFlick(performance.now());
  releaseDirX = flick.dirX;
  releaseDirY = flick.dirY;
  releaseDirAmount = flick.amount;

  audio.overcharge(0);
  const timing = audio.release({
    level: releaseLevel,
    power: releasePower,
    x: nx,
    y: ny,
    style: releaseStyle,
    directionX: releaseDirX,
    directionY: releaseDirY,
    directionAmount: releaseDirAmount,
  });
  impactAtMillis = p.millis() + timing.impactDelaySec * 1000;
  decayDurationMs = Math.max(DECAY_DURATION_MS, timing.dropSec * 1000);
  state = "inhale";
}

// 着弾: 物理を止めた 1 枚絵（ヒットストップ）を作ってから decay へ
function triggerImpact(now: number): void {
  energy = 1.0;
  timeScale = 0;

  for (const particle of particles) {
    particle.applyImpulse(releaseX, releaseY, releasePower, releaseDirX, releaseDirY, releaseDirAmount);
  }

  const waveLevel = Math.min(releasePower, 1.3);
  const styleHue = releaseStyle === "critical" ? CRITICAL_HUE : releaseStyle === "overload" ? OVERCHARGE_HUE : undefined;
  spawnShockwave(releaseX, releaseY, waveLevel, "lead");
  spawnShockwave(releaseX, releaseY, waveLevel, "main", styleHue);
  spawnShockwave(releaseX, releaseY, waveLevel, "echo");
  if (releaseStyle === "critical") {
    // 金の二重波
    spawnShockwave(releaseX, releaseY, waveLevel, "lead", CRITICAL_HUE, 70, 5);
    spawnShockwave(releaseX, releaseY, waveLevel * 0.8, "main", CRITICAL_HUE, 55, 12);
  } else if (releaseStyle === "overload") {
    // 赤い多重波（制御を失った連鎖）
    for (let i = 1; i <= 3; i++) {
      spawnShockwave(releaseX, releaseY, waveLevel * (1 - i * 0.12), "main", OVERCHARGE_HUE + i * 10, 90, i * 7);
    }
  }

  const intensity = Math.min(releasePower, 1);
  flashAlpha = lerp(FLASH_ALPHA_MIN, FLASH_ALPHA_MAX, intensity);
  flashHue = styleHue ?? 0;
  flashSat = styleHue === undefined ? 0 : 55;
  coreFlash = 1;
  shakeIntensity = Math.min(lerp(4, 40, intensity) * Math.max(releasePower, 1), 56);
  zoomVelocity = ZOOM_IMPACT_KICK * (0.4 + 0.6 * intensity) * Math.max(releasePower, 1);
  vibrate(releaseStyle === "normal" ? Math.round(25 + 60 * intensity) : [60, 40, 120]);

  const hitstopScale = releaseStyle === "overload" ? 1.4 : releaseStyle === "critical" ? 1.25 : 1;
  hitstopEndMillis = now + lerp(HITSTOP_MS_MIN, HITSTOP_MS_MAX, intensity) * hitstopScale;
  state = "impact";
  scheduleSecondaryBursts(hitstopEndMillis);
}

// 二次爆発の予約: 種類ごとに数と間隔と色を変える（通常は強く溜めたときだけ）
function scheduleSecondaryBursts(startMillis: number): void {
  secondaryBursts.length = 0;
  let count = 0;
  let spacingMs = 160;
  if (releaseStyle === "critical") {
    count = 7;
    spacingMs = 85;
  } else if (releaseStyle === "overload") {
    count = 10;
    spacingMs = 65;
  } else if (releaseLevel >= 0.66) {
    count = 3;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = (160 + Math.random() * 280) * Math.min(releasePower, 1.3);
    const x = releaseX + Math.cos(angle) * distance + releaseDirX * releaseDirAmount * 220;
    const y = releaseY + Math.sin(angle) * distance + releaseDirY * releaseDirAmount * 220;
    const hue =
      releaseStyle === "critical"
        ? CRITICAL_HUE + (Math.random() - 0.5) * 30
        : releaseStyle === "overload"
          ? OVERCHARGE_HUE + Math.random() * 35
          : Math.random() * 360;
    secondaryBursts.push({
      atMillis: startMillis + 200 + i * spacingMs + Math.random() * spacingMs * 0.6,
      x: Math.min(Math.max(x, 40), w - 40),
      y: Math.min(Math.max(y, 40), h - 40),
      intensity: 0.6 + Math.random() * 0.4,
      hue,
    });
  }
}

function updateSecondaryBursts(p: p5, now: number): void {
  if (secondaryBursts.length === 0) return;
  if (state !== "decay" && state !== "impact") {
    secondaryBursts.length = 0; // 溜め直したら残りは破棄
    return;
  }
  while (secondaryBursts.length > 0 && secondaryBursts[0].atMillis <= now) {
    const burst = secondaryBursts.shift();
    if (!burst) break;
    for (let i = 0; i < SECONDARY_SPARK_COUNT; i++) {
      const idx = (popSparkCursor + i) % particles.length;
      particles[idx].popSpark(burst.x, burst.y, 1.2 + burst.intensity);
    }
    popSparkCursor = (popSparkCursor + SECONDARY_SPARK_COUNT) % particles.length;
    spawnShockwave(burst.x, burst.y, 0.25 * burst.intensity, "tier", burst.hue, 75);
    shakeIntensity = Math.max(shakeIntensity, 3 * burst.intensity);
    audio.sparkBurst(burst.x / p.width, burst.intensity, releaseStyle);
  }
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

function spawnShockwave(
  px: number,
  py: number,
  waveLevel: number,
  kind: "lead" | "main" | "echo" | "tier",
  hue?: number,
  sat?: number,
  delayFrames = 0,
): void {
  // 非活性の個体を探して再利用。全部活性中なら最も薄い個体を上書き
  let target = shockwaves[0];
  for (const wave of shockwaves) {
    if (!wave.active) {
      target = wave;
      break;
    }
    if (wave.alphaVal < target.alphaVal) target = wave;
  }
  target.start(px, py, waveLevel, kind, hue, sat, delayFrames);
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
  currentTier = 0;
  fullChargeAtMillis = -1;
  overchargeAmount = 0;
  pointerSamples.length = 0;

  pointerX = clientX;
  pointerY = clientY;
  prevPointerX = clientX;
  prevPointerY = clientY;
  isPointerDown = true;

  const [nx, ny] = normalize(clientX, clientY, p.width, p.height);
  audio.chargeStart(nx, ny);
}

function handlePointerMove(clientX: number, clientY: number, pointerType: string): void {
  pointerX = clientX;
  pointerY = clientY;
  const now = performance.now();
  pointerSamples.push({ t: now, x: clientX, y: clientY });
  if (pointerSamples.length > 12) pointerSamples.shift();
  if (pointerType === "mouse" && !isPointerDown) lastHoverMoveMillis = now;

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

// スマホを振って解放: 溜め中に一定以上の加速度が来たら、その向きへのスリングショットとして解放する
function handleDeviceMotion(p: p5, event: DeviceMotionEvent): void {
  if (state !== "charging" || level < 0.3) return;
  const a = event.acceleration;
  if (!a || a.x === null || a.y === null) return;
  const magnitude = Math.hypot(a.x, a.y, a.z ?? 0);
  if (magnitude < SHAKE_RELEASE_ACCEL) return;
  // 端末座標系は y が上向き。画面座標（y 下向き）へ反転する
  const length = Math.hypot(a.x, a.y) || 1;
  const [nx, ny] = normalize(pointerX, pointerY, p.width, p.height);
  isPointerDown = false;
  beginRelease(p, nx, ny, undefined, { dirX: a.x / length, dirY: -a.y / length, amount: 0.8 });
}

// iOS 13+ はモーションセンサーの利用にユーザー操作起点の許可要求が必要
function requestMotionPermission(): void {
  const motion = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof motion.requestPermission === "function") {
    motion.requestPermission().catch(() => {
      // 拒否されても振って解放が使えないだけ。本体は動く
    });
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
    if (event.pointerType === "touch") requestMotionPermission();

    void audio.start().then(() => {
      handlePointerDown(p, event.clientX, event.clientY);
    });

    window.setTimeout(() => overlay.remove(), 500); // トランジション終了後に DOM から除去
  };

  overlay.addEventListener("pointerdown", onFirstPointerDown, { passive: false });
}

// ---- 背景の星雲（ゆっくり漂う 3 つの色の雲。状態で明るさと色が変わる）----

const NEBULA_BLOBS = [
  { hue: 190, speedX: 0.00011, speedY: 0.00017, phase: 0 },
  { hue: 318, speedX: 0.00013, speedY: 0.00009, phase: 2.1 },
  { hue: 260, speedX: 0.00007, speedY: 0.00012, phase: 4.2 },
];

function drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  let intensity = 0.05;
  if (state === "charging") intensity = 0.05 + 0.05 * level;
  else if (state === "decay") intensity = 0.05 + 0.1 * energy;
  const radius = Math.max(w, h) * 0.55;
  for (const blob of NEBULA_BLOBS) {
    const x = w * (0.5 + 0.38 * Math.sin(now * blob.speedX + blob.phase));
    const y = h * (0.5 + 0.34 * Math.cos(now * blob.speedY + blob.phase * 1.3));
    // 爆発直後は種類の色へ寄せる
    let hue = blob.hue;
    if (state === "decay" && releaseStyle !== "normal") {
      const target = releaseStyle === "critical" ? CRITICAL_HUE : OVERCHARGE_HUE;
      hue = hue + (((((target - hue) % 360) + 540) % 360) - 180) * energy;
    }
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `hsla(${hue}, 80%, 45%, ${intensity})`);
    gradient.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
}

function updateBeatPulse(amp: number, now: number): void {
  const rise = amp - ampSmoothed;
  ampSmoothed += (amp - ampSmoothed) * 0.25;
  if (state !== "decay" || energy < 0.08) return;
  if (rise > 0.22 && now - lastBeatPulseMillis > 250) {
    lastBeatPulseMillis = now;
    spawnShockwave(releaseX, releaseY, 0.35 + 0.4 * energy, "tier", (now * 0.05) % 360, 60);
    shakeIntensity = Math.max(shakeIntensity, 2.5 * energy);
    zoomVelocity -= 0.008 * energy;
  }
}

// ---- オーバーチャージの稲妻（核から走る赤い放電。毎フレーム形が変わる）----

function drawOvercharge(ctx: CanvasRenderingContext2D, amount: number): void {
  const cx = pointerX;
  const cy = pointerY;
  // 赤熱する核
  const coreRadius = 18 + 34 * amount * (0.85 + Math.random() * 0.3);
  ctx.fillStyle = `rgba(255,60,30,${0.12 + 0.3 * amount})`;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  const bolts = 1 + Math.floor(amount * 5);
  for (let b = 0; b < bolts; b++) {
    if (Math.random() > 0.35 + amount * 0.5) continue; // 明滅
    const angle = Math.random() * Math.PI * 2;
    const length = 60 + (120 + 260 * amount) * Math.random();
    const segments = 8;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 1; i <= segments; i++) {
      const along = (length * i) / segments;
      const jag = (Math.random() - 0.5) * 34 * (i / segments + 0.3);
      ctx.lineTo(cx + Math.cos(angle) * along + normalX * jag, cy + Math.sin(angle) * along + normalY * jag);
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,50,30,0.35)";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,235,220,0.9)";
    ctx.stroke();
  }
}

// ---- 溜めの進行表示（ポインタの周りの円弧 + 心拍の脈動）----

function drawChargeRing(p: p5): void {
  const cx = pointerX;
  const cy = pointerY;
  const tremble = overchargeAmount * 4;
  const r = CHARGE_RING_RADIUS + p.random(-tremble, tremble);
  const start = -Math.PI / 2;
  p.noFill();

  // 心拍: 拍ごとに外へ広がって消える輪。クリティカルが取れる溜め量なら拍の前後で金に光る
  const phase = audio.getHeartbeatPhase();
  const canCritical = level >= CRITICAL_MIN_LEVEL;
  const isOnBeat = phase <= CRITICAL_WINDOW || phase >= 1 - CRITICAL_WINDOW;
  p.strokeWeight(canCritical && isOnBeat ? 3 : 1.5);
  if (canCritical && isOnBeat) p.stroke(CRITICAL_HUE, 75, 100, 70);
  else p.stroke(190, 40, 100, (1 - phase) * 35 * (0.3 + level));
  p.circle(cx, cy, (r + 8 + phase * 34) * 2);

  // 下地の輪と段階の目盛り
  p.strokeWeight(1.5);
  p.stroke(190, 30, 70, 22);
  p.circle(cx, cy, r * 2);
  for (const threshold of CHARGE_TIERS) {
    const angle = start + Math.PI * 2 * threshold;
    p.line(cx + Math.cos(angle) * (r - 6), cy + Math.sin(angle) * (r - 6), cx + Math.cos(angle) * (r + 6), cy + Math.sin(angle) * (r + 6));
  }

  // 進行の円弧（段階ごとに色が変わり、満充填で白）
  const [hue, sat] = currentTier >= 3 ? [0, 0] : TIER_RING_COLORS[Math.max(currentTier, 0)];
  p.strokeWeight(3.5);
  p.stroke(hue, sat, 100, 85);
  if (level > 0.001) p.arc(cx, cy, r * 2, r * 2, start, start + Math.PI * 2 * Math.min(level, 0.9999));

  // オーバーチャージ: 外側に赤い円弧が伸び、満了で暴発
  if (overchargeAmount > 0) {
    p.strokeWeight(5);
    p.stroke(OVERCHARGE_HUE, 90, 100, 90);
    p.arc(cx, cy, (r + 14) * 2, (r + 14) * 2, start, start + Math.PI * 2 * Math.min(overchargeAmount, 0.9999));
  }
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
  p.text(`tier: ${currentTier}  overcharge: ${overchargeAmount.toFixed(2)}  last: ${releaseStyle} x${releasePower.toFixed(2)}`, 12, 92);
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
        handlePointerMove(event.clientX, event.clientY, event.pointerType);
      },
      { passive: false },
    );
    window.addEventListener("pointerup", () => handlePointerUp(p), { passive: false });
    window.addEventListener("pointercancel", () => handlePointerUp(p), { passive: false });
    // カーソルが窓の外へ出たらホバー反応を止める
    document.documentElement.addEventListener("pointerleave", () => {
      lastHoverMoveMillis = Number.NEGATIVE_INFINITY;
    });
    window.addEventListener("devicemotion", (event) => handleDeviceMotion(p, event));

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
      tier: currentTier,
      overcharge: overchargeAmount,
      releaseStyle,
      releasePower,
      releaseDirAmount,
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
    updateSecondaryBursts(p, p.millis());
    updateShake(p);
    updateCamera();

    // 背景をごく薄く重ねて軌跡（トレイル）を残す。カメラ変換の外（画面座標）で全面に掛ける
    p.blendMode(p.BLEND);
    p.noStroke();
    p.fill(bgHue, bgSat, bgBri, 55);
    p.rect(0, 0, p.width, p.height);
    // 2D context へ直接描く箇所は save/restore で囲む。p5 は fill/stroke の値をキャッシュし、
    // 同じ色なら ctx へ再設定しないため、直接書いた fillStyle が次フレームの p5 描画に漏れる
    // （漏れるとトレイル消去の矩形が星雲のグラデーションで塗られ、画面が飽和する ─ 実測）
    const directCtx = p.drawingContext as CanvasRenderingContext2D;
    directCtx.save();
    drawNebula(directCtx, p.width, p.height, p.millis());
    directCtx.restore();

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
    updateBeatPulse(f.amp, p.millis());
    f.width = p.width;
    f.height = p.height;
    f.overcharge = state === "charging" ? overchargeAmount : 0;
    f.burstStyle = releaseStyle;
    f.isHovering =
      (state === "idle" || state === "decay") && !isPointerDown && performance.now() - lastHoverMoveMillis < 2000;
    f.hoverX = pointerX;
    f.hoverY = pointerY;
    if (state === "charging") {
      f.level = level;
      f.attractorX = pointerX;
      f.attractorY = pointerY;
      // オーバーチャージ中は軌道半径が脈打って不安定になる
      const breathing = 1 + overchargeAmount * 1.6 * Math.sin(p.frameCount * 0.9);
      f.minOrbit = lerp(MIN_ORBIT_RADIUS_MAX, MIN_ORBIT_RADIUS_MIN, level) * breathing;
      f.pullStrength = lerp(PULL_STRENGTH_MIN, PULL_STRENGTH_MAX, level);
      f.swirl = TIER_SWIRL[currentTier];
    } else if (state === "inhale") {
      f.level = releaseLevel;
      f.attractorX = releaseX;
      f.attractorY = releaseY;
      f.minOrbit = INHALE_MIN_ORBIT;
      f.pullStrength = PULL_STRENGTH_MAX * INHALE_PULL_MUL;
      f.swirl = 0;
    } else {
      f.level = releaseLevel;
    }
    Particle.advanceFlowPhase();

    const pushers = state === "decay" ? shockwaves.filter((wave) => wave.isPushing) : [];
    const ctx = directCtx;
    ctx.save();
    ctx.lineCap = "round";
    for (const particle of particles) {
      particle.update(f);
      for (const wave of pushers) wave.pushParticle(particle);
      particle.display(ctx, f);
    }
    ctx.restore();

    for (const wave of shockwaves) {
      // 段階の輪は溜め中（等速）に出るので、スローモーションの影響を受けない
      wave.update(wave.kind === "tier" ? 1 : timeScale);
      wave.display();
    }

    if (state === "charging") {
      if (overchargeAmount > 0) {
        ctx.save();
        drawOvercharge(ctx, overchargeAmount);
        ctx.restore();
      }
      drawChargeRing(p);
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
      p.fill(flashHue, flashSat, 100, flashAlpha);
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
