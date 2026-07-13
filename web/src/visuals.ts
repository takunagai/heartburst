// ============================================================
// visuals.ts ─ Particle / Shockwave / ヴィネット生成
//
// processing/CatharsisField/Particle.pde, Shockwave.pde の 1:1 移植。
// アルゴリズム・定数は変更していない（コメントは pde 側の対応箇所を示す）。
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
  FRICTION,
  IMPULSE_SPEED_MIN,
  IMPULSE_SPEED_MAX,
  POP_SPARK_SPEED_MIN,
  POP_SPARK_SPEED_MAX,
  DECAY_SPEED_REF,
  SHOCKWAVE_RADIUS_MIN,
  SHOCKWAVE_RADIUS_MAX,
  VIGNETTE_INNER,
} from "./tuning";

const TWO_PI = Math.PI * 2;

// CatharsisField.pde の STATE_IDLE / STATE_CHARGING / STATE_RELEASING / STATE_DECAY に対応。
// 数値定数ではなく状態名なので文字列リテラル union として表現する。
export type SimState = "idle" | "charging" | "releasing" | "decay";

// ------------------------------------------------------------
// Particle ─ 粒子 1 個の状態と振る舞い（Particle.pde）
//
// idle    : パーリンノイズのフローフィールドで漂う（低輝度）
// charging: カーソルへ引力（level で強化）。最小軌道半径を下回ると
//           反発ジッターに切り替え、点に収束しすぎるのを防ぐ
// decay   : 摩擦で減速しつつフローフィールドへ回帰
// ------------------------------------------------------------
export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  baseSize: number;
  noiseOffset: number; // フローフィールドの個体差用オフセット

  // 個体色は不変なので HSB 分解までコンストラクタで済ませる
  // （display() で毎フレーム PARTICLE_COUNT 回の色空間変換をしない）
  hueVal: number;
  satVal: number;
  briBase: number;

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
  }

  respawnRandom(): void {
    this.x = this.p.random(this.p.width);
    this.y = this.p.random(this.p.height);
    this.vx = 0;
    this.vy = 0;
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

  update(
    state: SimState,
    chargeLevel: number,
    attractorX: number,
    attractorY: number,
    frameMinOrbit: number,
    framePullStrength: number,
  ): void {
    switch (state) {
      case "idle":
        this.flowDrift(1.0);
        break;
      case "charging":
        this.chargingPull(attractorX, attractorY, chargeLevel, frameMinOrbit, framePullStrength);
        break;
      case "releasing":
        // インパルス直後の 1 フレームのみ通過。速度は applyImpulse 済みなので摩擦のみ
        this.vx *= FRICTION;
        this.vy *= FRICTION;
        break;
      case "decay":
        this.vx *= FRICTION;
        this.vy *= FRICTION;
        this.flowDrift(0.35); // 摩擦をかけつつ緩やかにフローへ回帰
        break;
    }

    this.x += this.vx;
    this.y += this.vy;
    this.wrapEdges();
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

  private flowDrift(blend: number): void {
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
    this.vx = this.p.lerp(this.vx, this.targetVx, 0.06 * blend);
    this.vy = this.p.lerp(this.vy, this.targetVy, 0.06 * blend);
  }

  private chargingPull(
    attractorX: number,
    attractorY: number,
    chargeLevel: number,
    frameMinOrbit: number,
    framePullStrength: number,
  ): void {
    const dx = attractorX - this.x;
    const dy = attractorY - this.y;
    const d = Math.hypot(dx, dy) + 0.001;

    // 軌道半径・引力はフレーム不変（main.ts の draw が 1 回だけ算出済み）
    if (d > frameMinOrbit) {
      this.vx += (dx / d) * framePullStrength;
      this.vy += (dy / d) * framePullStrength;
    } else {
      // 軌道内では反発ジッターに切り替え、収束しすぎを防ぐ
      const jitter = JITTER_AMOUNT * chargeLevel;
      this.vx += this.p.random(-jitter, jitter);
      this.vy += this.p.random(-jitter, jitter);
    }

    this.vx *= CHARGE_DAMPING;
    this.vy *= CHARGE_DAMPING;
  }

  private wrapEdges(): void {
    const w = this.p.width;
    const h = this.p.height;
    if (this.x < 0) this.x += w;
    if (this.x > w) this.x -= w;
    if (this.y < 0) this.y += h;
    if (this.y > h) this.y -= h;
  }

  display(state: SimState, chargeLevel: number, ampSmoothed: number): void {
    // alpha は colorMode(HSB, 360, 100, 100, 100) のレンジ ─ 最大 100（255 ではない）
    let bri = this.briBase;
    let alphaVal = 22;
    let sizeMul = 1.0;

    if (state === "idle") {
      bri = this.briBase * 0.5;
      alphaVal = 18;
    } else if (state === "charging") {
      bri = this.p.lerp(this.briBase * 0.6, 100, chargeLevel);
      alphaVal = this.p.lerp(28, 88, chargeLevel);
      sizeMul = this.p.lerp(1.0, 1.6, chargeLevel);
    } else if (state === "releasing") {
      bri = 100;
      alphaVal = 95;
      sizeMul = 1.8;
    } else if (state === "decay") {
      const speedNorm = this.p.constrain(Math.hypot(this.vx, this.vy) / DECAY_SPEED_REF, 0, 1);
      bri = this.p.lerp(this.briBase * 0.5, 100, speedNorm);
      bri = Math.min(100, bri + ampSmoothed * 25); // /sc/amp 相当（audio.getAmp()）によるグロー脈動
      alphaVal = this.p.lerp(20, 82, speedNorm);
    }

    // ellipse より大幅に軽い point 描画
    this.p.stroke(this.hueVal, this.satVal, bri, alphaVal);
    this.p.strokeWeight(this.baseSize * sizeMul);
    this.p.point(this.x, this.y);
  }
}

// ------------------------------------------------------------
// Shockwave ─ 衝撃波リング（Shockwave.pde）
//
// release 時に爆心座標へ 1 個 spawn。半径膨張・線幅とアルファの
// 減衰で「空気の壁」感を表現する。配列使い回し（非活性個体を再利用）。
// ------------------------------------------------------------
export class Shockwave {
  active = false;
  x = 0;
  y = 0;
  radius = 0;
  maxRadius = 0;
  strokeW = 0;
  alphaVal = 0;

  private p: p5;

  constructor(p: p5) {
    this.p = p;
  }

  start(px: number, py: number, level: number): void {
    this.active = true;
    this.x = px;
    this.y = py;
    this.radius = 8;
    this.maxRadius = this.p.lerp(SHOCKWAVE_RADIUS_MIN, SHOCKWAVE_RADIUS_MAX, level);
    this.strokeW = this.p.lerp(3, 16, level);
    this.alphaVal = 100; // colorMode の alpha レンジは 100
  }

  update(): void {
    if (!this.active) return;
    this.radius += (this.maxRadius - this.radius) * 0.08 + 6;
    this.strokeW *= 0.965;
    this.alphaVal *= 0.93;
    if (this.alphaVal < 1.5 || this.radius >= this.maxRadius) {
      this.active = false;
    }
  }

  display(): void {
    if (!this.active) return;
    this.p.noFill();
    this.p.stroke(190, 70, 100, this.alphaVal); // シアン寄りの発光リング
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
