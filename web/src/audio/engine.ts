// ============================================================
// audio/engine.ts ─ AudioEngine インターフェースと Noop 実装
//
// Phase 2 で実装（Web Audio API）に差し替える。main.ts は
// createAudioEngine() 経由でのみ audio に触ること（差し替え時に
// main.ts を変更しないため）。audio/ 配下には他のファイルを作らない。
// ============================================================

export interface AudioEngine {
  start(): Promise<void>;
  chargeStart(x: number, y: number): void; // x,y は 0..1 正規化
  chargeLevel(level: number): void; // 毎フレーム呼ばれてよい
  release(level: number, x: number, y: number): void;
  pop(x: number, y: number): void;
  setEnergy(energy: number): void; // decay 中 1→0
  getAmp(): number; // マスター振幅 0..1
}

export class NoopAudioEngine implements AudioEngine {
  async start(): Promise<void> {}
  chargeStart(): void {}
  chargeLevel(): void {}
  release(): void {}
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
