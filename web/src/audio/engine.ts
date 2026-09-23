// ============================================================
// audio/engine.ts ─ AudioEngine インターフェースと Noop 実装
//
// main.ts は createAudioEngine() 経由でのみ audio に触ること
// （?mute の Noop と差し替えるため）。
// ============================================================

export interface SeedNote {
  slot: number; // 0..15（1 小節内の 16 分の位置）
  midi: number;
  pan: number; // -1..1
}

// release() の戻り値 ─ ビジュアルを音の着弾に合わせるためのタイミング情報
export interface ReleaseTiming {
  impactDelaySec: number; // 今から着弾音が「聞こえる」までの秒数（量子化待ち + 出力レイテンシ込み）
  dropSec: number; // 着弾後のドロップ区間の長さ（0 = ドロップなし）
}

// 爆発の種類: 通常 / クリティカル（心拍の頂点で解放）/ 暴発（オーバーチャージ満了）
export type BurstStyle = "normal" | "critical" | "overload";

export interface ReleaseParams {
  level: number; // 溜めレベル 0..1
  power: number; // 威力（1 を超えうる: オーバーチャージ・クリティカルの加算込み）
  x: number; // 0..1 正規化
  y: number;
  style: BurstStyle;
  directionX: number; // スリングショットの弾き方向（単位ベクトル。無ければ 0）
  directionY: number;
  directionAmount: number; // 指向性の強さ 0..1
}

export interface AudioEngine {
  start(): Promise<void>;
  chargeStart(x: number, y: number): void; // x,y は 0..1 正規化
  chargeLevel(level: number): void; // 毎フレーム呼ばれてよい
  tierUp(tier: number): void; // 段階チャージの閾値を越えた（1..3）
  overcharge(amount: number): void; // 満充填後の保持 0..1（毎フレーム。0 で停止）
  getHeartbeatPhase(): number; // 直近の心拍からの位相 0..1（0 = 鳴った瞬間）
  release(params: ReleaseParams): ReleaseTiming;
  sparkBurst(x: number, intensity: number, style: BurstStyle): void; // 二次爆発（花火の連鎖）
  pop(x: number, y: number, midi: number): void; // midi は music.tapToMidi で算出
  setSeeds(seeds: SeedNote[]): void; // 種のループシーケンサーの内容（変更時に全量を渡す）
  seedBurst(midi: number, pan: number, chainIndex: number): void; // 種の誘爆音
  getBarPhase(): number; // 小節内の位置 0..1（聞こえている位置）
  getNearestSlot(): number; // 今に最も近い 16 分の位置 0..15
  getChordIndex(): number; // コード進行の位置
  setEnergy(energy: number): void; // decay 中 1→0
  getAmp(): number; // マスター振幅 0..1
}

export class NoopAudioEngine implements AudioEngine {
  async start(): Promise<void> {}
  chargeStart(): void {}
  chargeLevel(): void {}
  tierUp(): void {}
  overcharge(): void {}
  getHeartbeatPhase(): number {
    return (performance.now() % 500) / 500;
  }
  release(params: ReleaseParams): ReleaseTiming {
    return { impactDelaySec: 0.04 + 0.1 * params.level, dropSec: 0 };
  }
  sparkBurst(): void {}
  setSeeds(): void {}
  seedBurst(): void {}
  getBarPhase(): number {
    return (performance.now() % 2400) / 2400;
  }
  getNearestSlot(): number {
    return Math.round(this.getBarPhase() * 16) % 16;
  }
  getChordIndex(): number {
    return 0;
  }
  pop(): void {}
  setEnergy(): void {}
  getAmp(): number {
    return 0;
  }
}

import { CatharsisAudioEngine } from "./catharsis-engine";

// URL に ?mute を付けると無音（視覚のみ）で起動できる
export function createAudioEngine(): AudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new CatharsisAudioEngine();
}
