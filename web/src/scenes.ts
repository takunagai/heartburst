// ============================================================
// scenes.ts ─ 場面（配色と一文）の定義（Phase 9-4）
//
// 強い解放を FINALE_RELEASES 回重ねると大団円の爆発が起き、次の場面へ移る。
// 粒子の色は 2 色（paletteA → paletteB）の間の個体差、星雲は 3 色で表す。
// ============================================================

export interface Scene {
  name: string;
  paletteA: number; // 粒子の色相の端 A
  paletteB: number; // 粒子の色相の端 B
  nebula: [number, number, number]; // 星雲の 3 色（黄〜橙 30〜80° は暗い低 alpha で茶色に濁るので避ける）
  caption: string; // この場面に入るときに浮かぶ一文
}

export const SCENES: Scene[] = [
  { name: "night", paletteA: 186, paletteB: 312, nebula: [190, 318, 260], caption: "もう一度、夜へ" },
  { name: "dawn", paletteA: 28, paletteB: 338, nebula: [340, 12, 305], caption: "夜が明ける" },
  { name: "aurora", paletteA: 140, paletteB: 275, nebula: [150, 280, 190], caption: "光が満ちる" },
  { name: "abyss", paletteA: 205, paletteB: 48, nebula: [215, 250, 190], caption: "深く、静かに" },
];

export const FINALE_RELEASES = 7; // 大団円までの強い解放の回数
