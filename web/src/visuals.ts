// ============================================================
// visuals.ts ─ Particle / Shockwave / 粒子描画 / ヴィネット生成
//
// 元は processing/CatharsisField/Particle.pde, Shockwave.pde の 1:1 移植。
// Phase 9-1 でウェブ版独自に拡張した（ネイティブ版は旧仕様のまま）:
//   - 解放シーケンスの状態（inhale / impact）と時間倍率（スローモーション）
//   - 速度ストリーク描画（p5 の stroke() を経由せず 2D context へ直接描く）
//   - 爆発中は端ワープせず画面外へ飛散 → 端から再流入
//   - 色温度（溜めで白熱、爆発で全色相へ散って戻る）
//   - 衝撃波 3 層（先行波・本波・残響波）と波面による粒子の押し出し
// ============================================================

import type p5 from "p5";
import {
  COLOR_CYAN_HEX,
  COLOR_MAGENTA_HEX,
  IDLE_SPEED,
  FLOW_SCALE,
  FLOW_TIME_SCALE,
  CHARGE_DAMPING,
  JITTER_AMOUNT,
  IMPULSE_SPEED_MIN,
  IMPULSE_SPEED_MAX,
  POP_SPARK_SPEED_MIN,
  POP_SPARK_SPEED_MAX,
  DECAY_SPEED_REF,
  SHOCKWAVE_RADIUS_MIN,
  SHOCKWAVE_RADIUS_MAX,
  VIGNETTE_INNER,
  STREAK_MIN_SPEED,
  STREAK_LENGTH_PER_SPEED,
  STREAK_MAX_LENGTH,
  EDGE_ESCAPE_MARGIN,
  EDGE_RESPAWN_SPEED,
  SHOCKWAVE_PUSH_BAND,
  SHOCKWAVE_PUSH_FORCE,
  SHOCKWAVE_ECHO_DELAY_FRAMES,
  CHARGE_DESATURATE,
  BURST_HUE_SPREAD,
} from "./tuning";

const TWO_PI = Math.PI * 2;

// idle ─→ charging ─→ inhale ─→ impact ─→ decay ─→ idle
// （pop は charging から直接 idle へ戻る軽量パス）
export type SimState = "idle" | "charging" | "inhale" | "impact" | "decay";

// 粒子ループの外で 1 フレームに 1 回だけ算出する値
export interface FrameParams {
  state: SimState;
  level: number; // 溜めレベル（inhale 以降は解放時の値で固定）
  energy: number; // decay 中 1→0
  attractorX: number;
  attractorY: number;
  minOrbit: number;
  pullStrength: number;
  timeScale: number; // スローモーション倍率（1 = 等速）
  friction: number; // FRICTION ** timeScale（時間倍率込みの摩擦）
  amp: number; // マスター振幅（グロー脈動用）
  width: number;
  height: number;
}

// ------------------------------------------------------------
// ColorCache ─ HSB を量子化して rgba 文字列をキャッシュする。
// p5 の stroke(h,s,b,a) は毎回 Color オブジェクト生成 + 色空間変換を行い、
// 4000 粒子 × 60fps では無視できないため、粒子描画は 2D context に直接書く。
// ------------------------------------------------------------
class ColorCache {
  private cache = new Map<number, string>();

  get(hue: number, sat: number, bri: number, alpha: number): string {
    const hq = Math.round((((hue % 360) + 360) % 360) / 5) % 72;
    const sq = Math.round(Math.min(Math.max(sat, 0), 100) / 10);
    const bq = Math.round(Math.min(Math.max(bri, 0), 100) / 5);
    const aq = Math.round(Math.min(Math.max(alpha, 0), 100) / 5);
    const key = ((hq * 11 + sq) * 21 + bq) * 21 + aq;
    let value = this.cache.get(key);
    if (value === undefined) {
      const [r, g, b] = hsbToRgb(hq * 5, sq * 10, bq * 5);
      value = `rgba(${r},${g},${b},${(aq * 5) / 100})`;
      this.cache.set(key, value);
    }
    return value;
  }
}

function hsbToRgb(hue: number, sat: number, bri: number): [number, number, number] {
  const s = sat / 100;
  const v = bri / 100;
  const k = (n: number) => (n + hue / 60) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

const colorCache = new ColorCache();

// ------------------------------------------------------------
// Particle ─ 粒子 1 個の状態と振る舞い
//
// idle    : パーリンノイズのフローフィールドで漂う（低輝度）
// charging: カーソルへ引力（level で強化）。最小軌道半径を下回ると
//           反発ジッターに切り替え、点に収束しすぎるのを防ぐ
// inhale  : charging と同じ力学を main 側の強化パラメータで回す（吸い込み）
// impact  : ヒットストップ ─ main が update を呼ばない（静止）
// decay   : 摩擦で減速しつつフローフィールドへ回帰。端ワープせず画面外へ飛散
// ------------------------------------------------------------
export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  baseSize: number;
  noiseOffset: number; // フローフィールドの個体差用オフセット

  // 個体色は不変なので HSB 分解までコンストラクタで済ませる
  hueVal: number;
  satVal: number;
  briBase: number;
  spectrumOffset: number; // 爆発直後に散る色相のずれ

  private p: p5;

  constructor(p: p5) {
    this.p = p;
    this.respawnRandom();
    this.baseSize = p.random(1.4, 3.0);
    this.noiseOffset = p.random(1000.0);

    // シアン〜マゼンタの個体差
    const c = p.lerpColor(p.color(COLOR_CYAN_HEX), p.color(COLOR_MAGENTA_HEX), p.random(1.0));
    this.hueVal = p.hue(c);
    this.satVal = p.saturation(c);
    this.briBase = p.brightness(c);
    this.spectrumOffset = (Math.random() - 0.5) * BURST_HUE_SPREAD;
  }

  respawnRandom(): void {
    this.x = this.p.random(this.p.width);
    this.y = this.p.random(this.p.height);
    this.vx = 0;
    this.vy = 0;
  }

  // 画面外へ飛び去った粒子を、ランダムな辺のすぐ外側から内向きに再流入させる
  private respawnAtEdge(w: number, h: number): void {
    const inward = this.p.random(0.6, 1.6);
    switch (Math.floor(Math.random() * 4)) {
      case 0:
        this.x = this.p.random(w);
        this.y = -8;
        this.vx = 0;
        this.vy = inward;
        break;
      case 1:
        this.x = w + 8;
        this.y = this.p.random(h);
        this.vx = -inward;
        this.vy = 0;
        break;
      case 2:
        this.x = this.p.random(w);
        this.y = h + 8;
        this.vx = 0;
        this.vy = -inward;
        break;
      default:
        this.x = -8;
        this.y = this.p.random(h);
        this.vx = inward;
        this.vy = 0;
        break;
    }
  }

  // pop（小破裂）用: 既存粒子を指定座標へワープさせ、放射状の初速を与える
  popSpark(px: number, py: number): void {
    this.x = px;
    this.y = py;
    const ang = this.p.random(TWO_PI);
    const spd = this.p.random(POP_SPARK_SPEED_MIN, POP_SPARK_SPEED_MAX);
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd;
  }

  // release（解放）用: 爆心からの放射インパルスを与える
  applyImpulse(cx: number, cy: number, releaseLevel: number): void {
    const dx = this.x - cx;
    const dy = this.y - cy;
    const d = Math.hypot(dx, dy) + 0.001;
    const speed = this.p.lerp(IMPULSE_SPEED_MIN, IMPULSE_SPEED_MAX, releaseLevel) * this.p.random(0.7, 1.3);
    this.vx += (dx / d) * speed;
    this.vy += (dy / d) * speed;
  }

  update(f: FrameParams): void {
    switch (f.state) {
      case "idle":
        this.flowDrift(1.0, 1.0);
        this.x += this.vx;
        this.y += this.vy;
        this.wrapEdges(f.width, f.height);
        return;
      case "charging":
      case "inhale":
        this.chargingPull(f);
        this.x += this.vx;
        this.y += this.vy;
        this.wrapEdges(f.width, f.height);
        return;
      case "impact":
        return; // ヒットストップ ─ 静止
      case "decay":
        this.vx *= f.friction;
        this.vy *= f.friction;
        this.flowDrift(0.35, f.timeScale); // 摩擦をかけつつ緩やかにフローへ回帰
        this.x += this.vx * f.timeScale;
        this.y += this.vy * f.timeScale;
        this.escapeEdges(f.width, f.height);
        return;
    }
  }

  // p5.noise は重い（4000 粒子 × 60fps は idle を 30fps に落とす実測）。
  // 目標速度ベクトルをキャッシュし、粒子ごとに 4 フレームに 1 回だけ再計算する。
  // lerp(0.06) の平滑化が挟まるため見た目の滑らかさは変わらない
  private targetVx = 0;
  private targetVy = 0;
  private static flowPhase = 0; // 全体で 0..3 を巡回。main が毎フレーム進める
  private static particleSeq = 0;
  private flowSlot = Particle.particleSeq++ % 4;

  static advanceFlowPhase(): void {
    Particle.flowPhase = (Particle.flowPhase + 1) % 4;
  }

  private flowDrift(blend: number, timeScale: number): void {
    if (this.flowSlot === Particle.flowPhase) {
      const n = this.p.noise(
        this.x * FLOW_SCALE,
        this.y * FLOW_SCALE,
        this.p.frameCount * FLOW_TIME_SCALE + this.noiseOffset,
      );
      const angle = n * TWO_PI * 4.0;
      this.targetVx = Math.cos(angle) * IDLE_SPEED;
      this.targetVy = Math.sin(angle) * IDLE_SPEED;
    }
    const t = 0.06 * blend * timeScale;
    this.vx += (this.targetVx - this.vx) * t;
    this.vy += (this.targetVy - this.vy) * t;
  }

  private chargingPull(f: FrameParams): void {
    const dx = f.attractorX - this.x;
    const dy = f.attractorY - this.y;
    const d = Math.hypot(dx, dy) + 0.001;

    if (d > f.minOrbit) {
      this.vx += (dx / d) * f.pullStrength;
      this.vy += (dy / d) * f.pullStrength;
    } else {
      // 軌道内では反発ジッターに切り替え、収束しすぎを防ぐ
      const jitter = JITTER_AMOUNT * f.level;
      this.vx += (Math.random() * 2 - 1) * jitter;
      this.vy += (Math.random() * 2 - 1) * jitter;
    }

    this.vx *= CHARGE_DAMPING;
    this.vy *= CHARGE_DAMPING;
  }

  // 反対側へのワープ。大きく画面外にいる粒子（飛散の生き残り）も 1 回で画面内へ戻す
  private wrapEdges(w: number, h: number): void {
    if (this.x < 0 || this.x > w) this.x = ((this.x % w) + w) % w;
    if (this.y < 0 || this.y > h) this.y = ((this.y % h) + h) % h;
  }

  // decay 中: ワープせず飛び去らせ、十分減速したら端から再流入
  private escapeEdges(w: number, h: number): void {
    const m = EDGE_ESCAPE_MARGIN;
    const isOutside = this.x < -m || this.x > w + m || this.y < -m || this.y > h + m;
    if (isOutside && Math.hypot(this.vx, this.vy) < EDGE_RESPAWN_SPEED) {
      this.respawnAtEdge(w, h);
    }
  }

  display(ctx: CanvasRenderingContext2D, f: FrameParams): void {
    // alpha / sat / bri は 0..100 レンジ
    let hue = this.hueVal;
    let sat = this.satVal;
    let bri = this.briBase;
    let alphaVal = 22;
    let sizeMul = 1.0;

    switch (f.state) {
      case "idle":
        bri = this.briBase * 0.5;
        alphaVal = 18;
        break;
      case "charging": {
        const l = f.level;
        bri = this.briBase * 0.6 + (100 - this.briBase * 0.6) * l;
        alphaVal = 28 + 60 * l;
        sizeMul = 1.0 + 0.6 * l;
        sat = this.satVal * (1 - CHARGE_DESATURATE * l * l); // 白熱
        break;
      }
      case "inhale":
      case "impact":
        bri = 100;
        alphaVal = 95;
        sizeMul = 1.8;
        sat = this.satVal * (1 - CHARGE_DESATURATE * Math.max(f.level, 0.5));
        break;
      case "decay": {
        const speedNorm = Math.min(Math.hypot(this.vx, this.vy) / DECAY_SPEED_REF, 1);
        const burstMix = f.energy * f.energy; // 爆発直後ほど全色相へ散る
        hue = this.hueVal + this.spectrumOffset * burstMix;
        sat = this.satVal + (100 - this.satVal) * burstMix * 0.5;
        bri = this.briBase * 0.5 + (100 - this.briBase * 0.5) * speedNorm;
        bri = Math.min(100, bri + f.amp * 25); // 音の振幅によるグロー脈動
        alphaVal = 20 + 62 * speedNorm;
        break;
      }
    }

    const speed = Math.hypot(this.vx, this.vy);
    ctx.lineWidth = this.baseSize * sizeMul;
    ctx.beginPath();
    if (speed >= STREAK_MIN_SPEED && f.state !== "idle") {
      // 速度ストリーク: 線が長いほど加算合成で明るくなりすぎるので alpha を少し落とす
      const len = Math.min(speed * STREAK_LENGTH_PER_SPEED, STREAK_MAX_LENGTH);
      alphaVal *= 1 / (1 + len * 0.012);
      ctx.moveTo(this.x - (this.vx / speed) * len, this.y - (this.vy / speed) * len);
      ctx.lineTo(this.x, this.y);
    } else {
      // 長さ 0 の線は描かれない環境があるため、ごく短い線 + round cap で点を描く
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + 0.01, this.y);
    }
    ctx.strokeStyle = colorCache.get(hue, sat, bri, alphaVal);
    ctx.stroke();
  }
}

// ------------------------------------------------------------
// Shockwave ─ 衝撃波リング
//
// 1 回の解放で 3 層を spawn する:
//   lead : 白く細い先行波。速く大きく広がる
//   main : マゼンタの太い本波。波面が粒子を外へ押す（空間の歪み）
//   echo : 遅れて出るシアンの残響波
// 配列使い回し（非活性個体を再利用）。
// ------------------------------------------------------------
export type ShockwaveKind = "lead" | "main" | "echo";

export class Shockwave {
  active = false;
  kind: ShockwaveKind = "main";
  x = 0;
  y = 0;
  radius = 0;
  maxRadius = 0;
  strokeW = 0;
  alphaVal = 0;
  level = 0;
  delayFrames = 0;

  private p: p5;

  constructor(p: p5) {
    this.p = p;
  }

  start(px: number, py: number, level: number, kind: ShockwaveKind): void {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const baseMax = lerp(SHOCKWAVE_RADIUS_MIN, SHOCKWAVE_RADIUS_MAX, level);
    this.active = true;
    this.kind = kind;
    this.x = px;
    this.y = py;
    this.level = level;
    this.radius = 8;
    this.delayFrames = 0;
    if (kind === "lead") {
      this.maxRadius = baseMax * 1.2;
      this.strokeW = lerp(1.5, 4, level);
      this.alphaVal = 100;
    } else if (kind === "main") {
      this.maxRadius = baseMax;
      this.strokeW = lerp(3, 18, level);
      this.alphaVal = 100;
    } else {
      this.maxRadius = baseMax * 0.75;
      this.strokeW = lerp(2, 8, level);
      this.alphaVal = 60;
      this.delayFrames = SHOCKWAVE_ECHO_DELAY_FRAMES;
    }
  }

  get isPushing(): boolean {
    return this.active && this.kind === "main" && this.delayFrames <= 0;
  }

  update(timeScale: number): void {
    if (!this.active || timeScale <= 0) return;
    if (this.delayFrames > 0) {
      this.delayFrames--;
      return;
    }
    const gap = this.maxRadius - this.radius;
    if (this.kind === "lead") {
      this.radius += (gap * 0.13 + 12) * timeScale;
      this.alphaVal *= Math.pow(0.9, timeScale);
    } else if (this.kind === "main") {
      this.radius += (gap * 0.08 + 6) * timeScale;
      this.alphaVal *= Math.pow(0.93, timeScale);
    } else {
      this.radius += (gap * 0.05 + 4) * timeScale;
      this.alphaVal *= Math.pow(0.94, timeScale);
    }
    this.strokeW *= Math.pow(0.965, timeScale);
    if (this.alphaVal < 1.5 || this.radius >= this.maxRadius) {
      this.active = false;
    }
  }

  // 波面付近の粒子を外向きに押す（本波のみ）
  pushParticle(particle: Particle): void {
    const dx = particle.x - this.x;
    const dy = particle.y - this.y;
    const d = Math.hypot(dx, dy) + 0.001;
    const fromFront = Math.abs(d - this.radius);
    if (fromFront > SHOCKWAVE_PUSH_BAND) return;
    const force = SHOCKWAVE_PUSH_FORCE * this.level * (1 - fromFront / SHOCKWAVE_PUSH_BAND) * (this.alphaVal / 100);
    particle.vx += (dx / d) * force;
    particle.vy += (dy / d) * force;
  }

  display(): void {
    if (!this.active || this.delayFrames > 0) return;
    this.p.noFill();
    if (this.kind === "lead") {
      this.p.stroke(0, 0, 100, this.alphaVal);
    } else if (this.kind === "main") {
      this.p.stroke(318, 80, 100, this.alphaVal);
    } else {
      this.p.stroke(190, 70, 100, this.alphaVal);
    }
    this.p.strokeWeight(Math.max(0.5, this.strokeW));
    this.p.ellipse(this.x, this.y, this.radius * 2, this.radius * 2);
  }
}

// ------------------------------------------------------------
// buildVignette ─ 画面端を暗くする放射グラデーションを 1 回だけピクセル単位で
// 生成する（CatharsisField.pde buildVignette()）。draw() では image() で
// 重ねるだけにして毎フレームコストを避ける。ウィンドウリサイズ時は
// 呼び出し側（main.ts）が windowResized で再生成する。
// ------------------------------------------------------------
export function buildVignette(p: p5, w: number, h: number): p5.Image {
  const img = p.createImage(w, h);
  img.loadPixels();
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.hypot(cx, cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxDist;
      const a = p.constrain(p.map(d, VIGNETTE_INNER, 1.0, 0, 255), 0, 255);
      const idx = (y * w + x) * 4;
      img.pixels[idx] = 0;
      img.pixels[idx + 1] = 0;
      img.pixels[idx + 2] = 0;
      img.pixels[idx + 3] = a;
    }
  }

  img.updatePixels();
  return img;
}
