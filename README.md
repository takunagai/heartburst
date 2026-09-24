<p align="center">
  <img src="docs/images/heartburst-logo.png" alt="Heartburst" width="720" />
</p>

# Heartburst

旧称 CatharsisField（2026-09-24 改名。フォルダ・URL・内部の名前もすべて Heartburst に統一）。

溜めて、放つ。胸の内を弾けさせる、カタルシスのインタラクティブ・アート。

マウス長押し・ドラッグで緊張を蓄積（粒子が指先に集束、ドローンと心拍が高まる）、離した瞬間に爆発（粒子バースト + 衝撃波リング + サブベース・ドロップ + 残響シャワー）。短いクリック連打でも小気味よい破裂が返る。

- ビジュアル: Processing 4（粒子 4000、ダーク＋ネオン、加算合成）
- 音響: SuperCollider 3.14（カスタム SynthDef）
- パターン層: Tidal Cycles + SuperDirt（心拍・グルーヴ・アンビエント ─ オプショナル）
- 連携: OSC（設計正本: [docs/architecture.md](docs/architecture.md)）

## 起動

```bash
./bin/start.sh            # フル起動（SC → Tidal → Processing）
./bin/start.sh --no-tidal # Tier 1（SC + Processing のみ）
```

終了は Ctrl+C（全プロセスを後始末）。ログは `/tmp/heartburst/`。

## 操作

| 操作 | 反応 |
|---|---|
| 長押し（〜3 秒で満充填） | 粒子集束 + ドローン上昇 + 心拍加速 |
| ドラッグしながら溜め | 溜め速度ブースト |
| 離す | 爆発（強度 = 溜めレベル） |
| 短クリック | 小破裂（連打向け） |
| `d` キー | デバッグ HUD（fps / state / level） |

## ウェブ版（web/）

ブラウザだけで動く版（p5.js + Web Audio + Strudel）。ネイティブ版の「溜めて解放」に、ゲーム性・楽器・物語を足している。

```bash
cd web && pnpm install && pnpm dev
```

| 操作 | 反応 |
|---|---|
| 長押し | 溜め。33 / 66 / 100% で段階が上がり、渦が強まる |
| 離す | 吸い込み → 無音 → 拍に揃った爆発とドロップ（強く溜めるほど長い） |
| 満充填のまま押し続ける | オーバーチャージ（赤熱・稲妻）。限界で暴発 |
| 心拍の頂点（金の輪）で離す | クリティカル（金の爆発） |
| 離す瞬間に弾く | 弾いた方向へ吹き飛ぶ |
| 短いタップ | 位置で音程が決まり、光る種が残る。種は 1 小節ループで鳴り続け、爆発に触れると連鎖して誘爆 |
| 「言葉を書いて、壊す」 | 入力した言葉を粒子が形作る。溜めて解放すると砕ける（入力は送信・保存しない） |
| 強い解放を 7 回 | 大団円。積もった痕跡が一斉に弾け、場面（配色）が移る |
| 「声で溜める」をオン | 叫ぶと画面中央で溜まり、声を止めると解放（長押し中は声で加速）。マイクは音量の計測だけに使う（https / localhost のみ） |
| スマホを振る（溜め中） | その向きへ解放 |
| `?` キー / 右下の「?」/ タイトルの How to Play | 遊び方（日英。ブラウザの言語で自動選択、トグルで切り替え） |
| `d` キー | デバッグ HUD |

チューニング定数は `web/src/tuning.ts`（演出）、`web/src/music.ts`（音程・コード進行）、`web/src/scenes.ts`（場面）、`web/src/audio/heartburst-engine.ts` 冒頭（音響）。

## チューニング

体感調整の主要ノブ（すべて定数化済み）:

| 対象 | 場所 |
|---|---|
| マスター音量・リバーブ | `sc/main.scd` 冒頭の `~masterVolume` / `~reverbMix` / `~reverbRoom` / `~reverbDamp`（ライブ調整は `~master.set(\amp, 0.8)` 等） |
| シャワーの密度・長さ | `sc/main.scd` の `/release` OSCdef 内 `baseDensity`（level→3..14 notes/sec）と `total = 3.0` |
| ワンショット音量 | `\dropBoom` / `\shockwave` の amp マッピング、`\shimmer` の amp 係数 |
| 溜め/減衰テンポ・粒子数・演出強度 | `processing/Heartburst/Heartburst.pde` 冒頭の定数群（`CHARGE_DURATION_MS` / `DECAY_DURATION_MS` / `PARTICLE_COUNT` ほか） |
| パターン層の音量・追従感度 | `tidal/performance.tidal` 各レイヤーの `gain` / `lpf` / `degradeBy` の係数 |

## 依存セットアップ

構築手順の詳細と判断記録は [docs/process-log.md](docs/process-log.md) を参照。

1. `brew install --cask supercollider processing`
2. oscP5: [sojamo/oscp5 releases](https://github.com/sojamo/oscp5/releases) の zip を `~/Documents/Processing/libraries/` に展開
3. （Tier 2）`brew install ghc cabal-install && cabal update && cabal install tidal --lib`
4. （Tier 2）SuperDirt quark: `sclang` で `Quarks.install("SuperDirt")`
