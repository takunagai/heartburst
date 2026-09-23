// ============================================================
// audio/engine.ts ─ AudioEngine インターフェースと Noop 実装
//
// main.ts は createAudioEngine() 経由でのみ audio に触ること
// （?mute の Noop と差し替えるため）。
// ============================================================

// release() の戻り値 ─ ビジュアルを音の着弾に合わせるためのタイミング情報
export interface ReleaseTiming {
  impactDelaySec: number; // 今から着弾音が「聞こえる」までの秒数（量子化待ち + 出力レイテンシ込み）
  dropSec: number; // 着弾後のドロップ区間の長さ（0 = ドロップなし）
}

export interface AudioEngine {
  start(): Promise<void>;
  chargeStart(x: number, y: number): void; // x,y は 0..1 正規化
  chargeLevel(level: number): void; // 毎フレーム呼ばれてよい
  release(level: number, x: number, y: number): ReleaseTiming;
  pop(x: number, y: number): void;
  setEnergy(energy: number): void; // decay 中 1→0
  getAmp(): number; // マスター振幅 0..1
}

export class NoopAudioEngine implements AudioEngine {
  async start(): Promise<void> {}
  chargeStart(): void {}
  chargeLevel(): void {}
  release(level: number): ReleaseTiming {
    return { impactDelaySec: 0.04 + 0.1 * level, dropSec: 0 };
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
