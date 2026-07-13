// ============================================================
// Strudel パターン層 ─ tidal/performance.tidal の写像（Tier 2 相当）
//
// - 外部値注入: signal(() => __catharsis.charge / .energy)
//   （クエリごとにコールバックが再実行されるため再評価不要）
// - 音源は内蔵シンセのみ（外部 CDN サンプル不使用・オフライン動作）
// - 失敗しても本体（音響エンジン+ビジュアル）は動く ─ オプショナル層
// ============================================================

import { controlSignals } from "./catharsis-engine";

// Strudel（AGPLv3）は動的 import ─ クリックゲート後に初めてロードする
export async function startPatternLayer(ctx: AudioContext): Promise<boolean> {
  try {
    const strudel: any = await import("@strudel/web");
    strudel.setAudioContext?.(ctx); // 音響エンジンと同一 AudioContext を共有
    await strudel.initStrudel();
    // initAudioOnFirstClick は「次のクリック」を待ってしまう（ゲートのクリックは消費済み）。
    // ここは既にユーザー操作後なので worklet ロードを明示的に済ませる
    await strudel.initAudio?.();
    (globalThis as any).__catharsis = controlSignals;
    await strudel.evaluate(PATTERN_CODE);
    return true;
  } catch (error) {
    console.warn("[pattern] Strudel 層の起動に失敗（本体は継続）:", error);
    return false;
  }
}

export async function stopPatternLayer(): Promise<void> {
  try {
    const strudel: any = await import("@strudel/web");
    strudel.hush();
  } catch {
    // 未ロードなら何もしない
  }
}

// performance.tidal の 4 レイヤー対応（heartbeat / groove / afterglow / ambient）
const PATTERN_CODE = `
setcps(100/60/4)

const charge = signal(() => __catharsis.charge)
const energy = signal(() => __catharsis.energy)
const tension = charge.add(energy)

stack(
  // 心拍 ─ 溜め中だけ。安静 50bpm 相当から満充填 175bpm 相当へ加速
  note("c1 ~ c1 ~")
    .s("sine").attack(0.001).decay(0.14).sustain(0)
    .fast(charge.mul(2.5).add(1).segment(1))
    .gain(charge.mul(1.15))
    .lpf(charge.mul(2500).add(150))
    .shape(0.35),

  // グルーヴ（ハット）─ 解放後に湧き、energy 減衰とともに消える
  s("white*8")
    .decay(0.04).sustain(0)
    .gain(energy.mul(0.45))
    .hpf(4000)
    .degradeBy(0.25)
    .room(0.3),

  // グルーヴ（パルス）─ 骨格のリズム
  note("c4 ~ ~ c4 ~ ~ c4 ~")
    .s("square").decay(0.08).sustain(0)
    .gain(energy.mul(0.5))
    .lpf(1200)
    .room(0.3),

  // 残光アルペジオ ─ C マイナーペンタ系の余韻。energy で明るさが開く
  note("c5 eb5 g5 bb5 c6 bb5 g5 eb5")
    .s("triangle").decay(0.25).sustain(0)
    .gain(energy.mul(0.7))
    .lpf(energy.mul(4000).add(600))
    .room(0.6)
    .fast(2),

  // アンビエント床 ─ 常時ごく薄く、tension でわずかに開く
  note("<c2 g1 bb1 f2>")
    .s("sawtooth").attack(1.5).release(2).sustain(0.6)
    .gain(tension.mul(0.12).add(0.1))
    .lpf(tension.mul(1200).add(400))
    .room(0.85)
    .slow(4)
)
`;
