// ============================================================
// Strudel パターン層 ─ tidal/performance.tidal の写像（Tier 2 相当）
//
// - 外部値注入: signal(() => __catharsis.charge / .energy)
//   （クエリごとにコールバックが再実行されるため再評価不要）
// - 音源は内蔵シンセのみ（外部 CDN サンプル不使用・オフライン動作）
// - 失敗しても本体（音響エンジン+ビジュアル）は動く ─ オプショナル層
// ============================================================

import { controlSignals } from "./catharsis-engine";
import type { Chord } from "../music";

let strudelModule: any = null;

// Strudel スケジューラ（@strudel/core の Cyclist）のうち、拍位置の換算に使う内部フィールド。
// 公開 API ではないため、読み出し側（catharsis-engine.ts）は欠損時に自前クロックへ退避する。
// 換算式は Cyclist の onTrigger と同一: 発音時刻 = (cycle - n0) / cps + s0 + latency
export interface StrudelClock {
  started: boolean;
  cps: number;
  latency: number;
  num_cycles_at_cps_change: number;
  seconds_at_cps_change: number | undefined;
}

// Strudel（AGPLv3）は動的 import ─ クリックゲート後に初めてロードする。
// destination: Strudel の出力の接続先（音響エンジンのマスター系統。無音の間・ポンピングを一括で掛けるため）
export async function startPatternLayer(
  ctx: AudioContext,
  destination: AudioNode,
  chord: Chord,
): Promise<StrudelClock | null> {
  try {
    const strudel: any = await import("@strudel/web");
    strudel.setAudioContext?.(ctx); // 音響エンジンと同一 AudioContext を共有
    const repl = await strudel.initStrudel();
    // initAudioOnFirstClick は「次のクリック」を待ってしまう（ゲートのクリックは消費済み）。
    // ここは既にユーザー操作後なので worklet ロードを明示的に済ませる
    await strudel.initAudio?.();
    (globalThis as any).__catharsis = controlSignals;
    await strudel.evaluate(buildPatternCode(chord));
    strudelModule = strudel;

    // superdough の最終段（destinationGain → ctx.destination）を付け替え、エンジンのマスター系統へ合流させる
    const output: GainNode | null | undefined = strudel.getSuperdoughAudioController?.()?.output?.destinationGain;
    if (output) {
      output.disconnect();
      output.connect(destination);
    } else {
      console.warn("[pattern] Strudel の出力ノードが見つからない（無音の間・ポンピングは Strudel 層に掛からない）");
    }

    return (repl?.scheduler as StrudelClock | undefined) ?? null;
  } catch (error) {
    console.warn("[pattern] Strudel 層の起動に失敗（本体は継続）:", error);
    return null;
  }
}

// コード進行に合わせてパターンを差し替える（再評価はスケジューラを止めずに次のクエリから効く）
export function setPatternChord(chord: Chord): void {
  if (!strudelModule) return;
  strudelModule.evaluate(buildPatternCode(chord)).catch((error: unknown) => {
    console.warn("[pattern] コード変更の再評価に失敗（前のパターンで継続）:", error);
  });
}

export async function stopPatternLayer(): Promise<void> {
  try {
    const strudel: any = await import("@strudel/web");
    strudel.hush();
  } catch {
    // 未ロードなら何もしない
  }
}

// performance.tidal の 4 レイヤー対応（heartbeat / groove / afterglow / ambient）。
// Phase 9-3: 音程はコードから組み立てる（mini notation の数値 = MIDI ノート番号）
function buildPatternCode(chord: Chord): string {
  const root = chord.root > 6 ? chord.root - 12 : chord.root; // 低音域が上がりすぎないように
  const [a, b, c, d] = chord.tones.map((t) => 72 + t);
  const arp = [a, b, c, d, a + 12, d, c, b].join(" ");
  const floor = [36 + root, 31 + root, 34 + root, 41 + root].join(" ");
  const beat = 24 + root;
  return `
setcps(100/60/4)

const charge = signal(() => __catharsis.charge)
const energy = signal(() => __catharsis.energy)
const tension = charge.add(energy)

stack(
  // 心拍 ─ 溜め中だけ。安静 50bpm 相当から満充填 175bpm 相当へ加速
  note("${beat} ~ ${beat} ~")
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

  // グルーヴ（パルス）─ 骨格のリズム。コードのルート
  note("${60 + root} ~ ~ ${60 + root} ~ ~ ${60 + root} ~")
    .s("square").decay(0.08).sustain(0)
    .gain(energy.mul(0.5))
    .lpf(1200)
    .room(0.3),

  // 残光アルペジオ ─ コードの構成音。energy で明るさが開く
  note("${arp}")
    .s("triangle").decay(0.25).sustain(0)
    .gain(energy.mul(0.7))
    .lpf(energy.mul(4000).add(600))
    .room(0.6)
    .fast(2),

  // アンビエント床 ─ 常時ごく薄く、tension でわずかに開く
  note("<${floor}>")
    .s("sawtooth").attack(1.5).release(2).sustain(0.6)
    .gain(tension.mul(0.12).add(0.1))
    .lpf(tension.mul(1200).add(400))
    .room(0.85)
    .slow(4)
)
`;
}
