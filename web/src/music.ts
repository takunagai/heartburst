// ============================================================
// music.ts ─ 音楽の共通定義（Phase 9-3）
//
// 音響エンジン（音程）と main（色・種の配置）の両方が参照する。
//   - タップ位置 → 音程: x = 音階度数（C マイナーペンタ）、y = オクターブ（上ほど高い）
//   - 音程 → 色相: 音階度数ごとに色環を割り当てる（同じ音は同じ色）
//   - コード進行: 解放のたびに i → VI → III → VII（Cm → A♭ → E♭ → B♭）
// ============================================================

export const PENTA = [0, 3, 5, 7, 10];
export const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

export const midicps = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const TAP_BASE_MIDI = 60; // C4
export const TAP_OCTAVES = 3;

export function tapToMidi(nx: number, ny: number): number {
  const degree = Math.min(Math.max(Math.floor(nx * PENTA.length), 0), PENTA.length - 1);
  const octave = Math.min(Math.max(Math.floor((1 - ny) * TAP_OCTAVES), 0), TAP_OCTAVES - 1);
  return TAP_BASE_MIDI + 12 * octave + PENTA[degree];
}

// タップで鳴りうる全音程（プラックの事前合成バンク用）
export const TAP_MIDIS = Array.from({ length: TAP_OCTAVES }, (_, octave) =>
  PENTA.map((d) => TAP_BASE_MIDI + 12 * octave + d),
).flat();

// 音階度数ごとの色相（シアン → 青 → 紫 → マゼンタ → 橙）。オクターブが上がるほど明るく見せるのは描画側
const DEGREE_HUES = [186, 220, 265, 318, 28];

export function midiHue(midi: number): number {
  const pitchClass = ((midi % 12) + 12) % 12;
  const degree = PENTA.indexOf(pitchClass);
  return degree >= 0 ? DEGREE_HUES[degree] : 186;
}

export interface Chord {
  name: string;
  root: number; // C からの半音
  tones: number[]; // C からの半音（オクターブ内に収めない ─ 転回をそのまま持つ）
  hueShift: number; // 背景の星雲の色相のずらし量
}

export const CHORD_PROGRESSION: Chord[] = [
  { name: "Cm", root: 0, tones: [0, 3, 7, 10], hueShift: 0 },
  { name: "Ab", root: 8, tones: [8, 12, 15, 19], hueShift: 14 },
  { name: "Eb", root: 3, tones: [3, 7, 10, 14], hueShift: -18 },
  { name: "Bb", root: 10, tones: [10, 14, 17, 21], hueShift: 24 },
];

// 残響シャワー用の音域（C5 以上の自然短音階 2 オクターブ。どのコードの構成音もこの中に入る）
export const SHOWER_MIDIS = [72, 84]
  .flatMap((base) => NATURAL_MINOR.map((d) => base + d))
  .concat([96]);

export function chordShowerMidis(chord: Chord): number[] {
  return [72, 84].flatMap((base) => chord.tones.map((t) => base + t)).filter((m) => SHOWER_MIDIS.includes(m));
}
