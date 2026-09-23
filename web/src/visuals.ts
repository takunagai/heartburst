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
// Phase 9-2:
//   - 段階チャージの渦、オーバーチャージの不安定化と赤熱、カーソルを避ける idle 粒子
//   - 爆発の種類別の配色（クリティカル = 金 / 暴発 = 赤）とスリングショットの指向性インパルス
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
  HOVER_RADIUS,
  HOVER_FORCE,
  HOVER_BRIGHTEN,
  OVERCHARGE_HUE,
  CRITICAL_HUE,
} from "./tuning";
import type { BurstStyle } from "./audio/engine";

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
  swirl: number; // 溜め中の渦の強さ（接線方向の力 / 引力比）
  overcharge: number; // 満充填後の保持 0..1
  isHovering: boolean; // idle 中にカーソルが画面上で動いている
  hoverX: number;
  hoverY: number;
  burstStyle: BurstStyle;
}

// 色相の最短経路での補間（300° → 8° を緑経由にしない）
function lerpHue(from: number, to: number, t: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  return from + diff * t;
}

function burstHue(style: BurstStyle): number | null {
  if (style === "critical") return CRITICAL_HUE;
  if (style === "overload") return OVERCHARGE_HUE;
  return null;
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
  proximity = 0; // idle 中のカーソルへの近さ 0..1（輝度加算用）

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
  popSpark(px: number, py: number, speedScale = 1): void {
    this.x = px;
    this.y = py;
    const ang = this.p.random(TWO_PI);
    const spd = this.p.random(POP_SPARK_SPEED_MIN, POP_SPARK_SPEED_MAX) * speedScale;
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd;
  }

  // release（解放）用: 爆心からの放射インパルスを与える。
  // power > 1（オーバーチャージ・クリティカル）はその比で速度を上乗せ。
  // 弾き方向があれば、その向きの粒子ほど速く・全体を同じ向きへ流す（スリングショット）
  applyImpulse(cx: number, cy: number, power: number, dirX: number, dirY: number, dirAmount: number): void {
    const dx = this.x - cx;
    const dy = this.y - cy;
    const d = Math.hypot(dx, dy) + 0.001;
    const base = IMPULSE_SPEED_MIN + (IMPULSE_SPEED_MAX - IMPULSE_SPEED_MIN) * Math.min(power, 1);
    // 威力 1 超過ぶんは控えめに上乗せ（全粒子が画面外へ抜けて画面が空になるのを防ぐ。派手さは二次爆発・色・輪で出す）
    let speed = base * (1 + Math.max(power - 1, 0) * 0.35) * this.p.random(0.7, 1.3);
    if (dirAmount > 0) {
      const alignment = (dx / d) * dirX + (dy / d) * dirY; // -1..1
      speed *= 1 + dirAmount * alignment * 0.9;
      this.vx += dirX * base * dirAmount * 0.55;
      this.vy += dirY * base * dirAmount * 0.55;
    }
    this.vx += (dx / d) * speed;
    this.vy += (dy / d) * speed;
  }

  update(f: FrameParams): void {
    switch (f.state) {
      case "idle":
        this.flowDrift(1.0, 1.0);
        this.hoverRepel(f);
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
        this.hoverRepel(f);
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

  // カーソルの周りだけ粒子がそっと避ける（触る前から「生きている」と感じさせる）
  private hoverRepel(f: FrameParams): void {
    this.proximity = 0;
    if (!f.isHovering) return;
    const dx = this.x - f.hoverX;
    const dy = this.y - f.hoverY;
    if (Math.abs(dx) > HOVER_RADIUS || Math.abs(dy) > HOVER_RADIUS) return;
    const d = Math.hypot(dx, dy) + 0.001;
    if (d > HOVER_RADIUS) return;
    const closeness = 1 - d / HOVER_RADIUS;
    this.proximity = closeness;
    const force = HOVER_FORCE * closeness * closeness;
    this.vx += (dx / d) * force;
    this.vy += (dy / d) * force;
  }

  private chargingPull(f: FrameParams): void {
    const dx = f.attractorX - this.x;
    const dy = f.attractorY - this.y;
    const d = Math.hypot(dx, dy) + 0.001;

    if (d > f.minOrbit) {
      this.vx += (dx / d) * f.pullStrength;
      this.vy += (dy / d) * f.pullStrength;
      // 渦: 引力に直交する成分（段階が上がるほど銀河のような渦巻きになる）
      this.vx += (-dy / d) * f.pullStrength * f.swirl;
      this.vy += (dx / d) * f.pullStrength * f.swirl;
    } else {
      // 軌道内では反発ジッターに切り替え、収束しすぎを防ぐ。オーバーチャージで暴れる
      const jitter = JITTER_AMOUNT * (f.level + f.overcharge * 2.5);
      this.vx += (Math.random() * 2 - 1) * jitter;
      this.vy += (Math.random() * 2 - 1) * jitter;
    }

    // オーバーチャージ: 核から火花が噴き出しては引き戻される（抑えきれないエネルギー）
    if (f.overcharge > 0 && Math.random() < f.overcharge * 0.006) {
      const angle = Math.random() * TWO_PI;
      const kick = 14 + 26 * f.overcharge * Math.random();
      this.vx += Math.cos(angle) * kick;
      this.vy += Math.sin(angle) * kick;
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
        bri = Math.min(100, this.briBase * 0.72 + this.proximity * HOVER_BRIGHTEN);
        alphaVal = 34 + this.proximity * 45;
        if (Math.random() < 0.002) {
          // ときどき瞬く（静止画に見えないように）
          bri = 100;
          alphaVal = 80;
        }
        break;
      case "charging": {
        const l = f.level;
        bri = this.briBase * 0.6 + (100 - this.briBase * 0.6) * l;
        alphaVal = 28 + 60 * l;
        sizeMul = 1.0 + 0.6 * l;
        sat = this.satVal * (1 - CHARGE_DESATURATE * l * l); // 白熱
        if (f.overcharge > 0) {
          // 白熱から赤熱へ（危険の合図）
          hue = lerpHue(hue, OVERCHARGE_HUE + this.spectrumOffset * 0.05, f.overcharge);
          sat = sat + (95 - sat) * f.overcharge * 0.85;
        }
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
        const styleHue = burstHue(f.burstStyle);
        if (styleHue === null) {
          hue = this.hueVal + this.spectrumOffset * burstMix;
        } else {
          // クリティカル = 金、暴発 = 赤に染まり、残光で元の色へ戻る
          hue = lerpHue(this.hueVal, styleHue + this.spectrumOffset * 0.12, Math.min(f.energy * 1.4, 1));
        }
        sat = this.satVal + (100 - this.satVal) * burstMix * 0.5;
        // 余韻: 減速しても energy に比例した明るさを保つ（ドロップ区間のあいだ画面が暗くならないように）
        const glowNorm = Math.max(speedNorm, f.energy * 0.65);
        bri = this.briBase * 0.55 + (100 - this.briBase * 0.55) * glowNorm;
        bri = Math.min(100, bri + f.amp * 25 + this.proximity * HOVER_BRIGHTEN); // 音の振幅によるグロー脈動
        alphaVal = 26 + 62 * glowNorm + this.proximity * 30;
        sizeMul = 1 + f.amp * f.energy * 1.4; // キックに合わせて脈打つ
        // 減速した粒子はきらめく（花火の残り火）。爆発直後ほど多い
        if (speedNorm < 0.4 && Math.random() < 0.06 * f.energy) {
          bri = 100;
          alphaVal = 95;
          sizeMul = 1.6;
        }
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
export type ShockwaveKind = "lead" | "main" | "echo" | "tier";

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
  hue = 0;
  sat = 0;

  private p: p5;

  constructor(p: p5) {
    this.p = p;
  }

  // hue/sat を省略すると種類ごとの既定色（lead = 白 / main = マゼンタ / echo = シアン）
  start(px: number, py: number, level: number, kind: ShockwaveKind, hue?: number, sat?: number, delayFrames = 0): void {
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
    } else if (kind === "echo") {
      this.maxRadius = baseMax * 0.75;
      this.strokeW = lerp(2, 8, level);
      this.alphaVal = 60;
      this.delayFrames = SHOCKWAVE_ECHO_DELAY_FRAMES;
    } else {
      // tier: 段階チャージの節目の輪（小さく速い）
      this.radius = 40;
      this.maxRadius = 170 + 60 * level;
      this.strokeW = 2 + 2 * level;
      this.alphaVal = 90;
    }
    const defaults: Record<ShockwaveKind, [number, number]> = {
      lead: [0, 0],
      main: [318, 80],
      echo: [190, 70],
      tier: [190, 60],
    };
    this.hue = hue ?? defaults[kind][0];
    this.sat = sat ?? defaults[kind][1];
    this.delayFrames += delayFrames;
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
    } else if (this.kind === "echo") {
      this.radius += (gap * 0.05 + 4) * timeScale;
      this.alphaVal *= Math.pow(0.94, timeScale);
    } else {
      this.radius += (gap * 0.16 + 3) * timeScale;
      this.alphaVal *= Math.pow(0.88, timeScale);
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
    this.p.stroke(this.hue, this.sat, 100, this.alphaVal);
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
