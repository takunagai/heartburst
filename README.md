# CatharsisField

溜めて、解放する。カタルシス解消を体感するインタラクティブ・アート。

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

終了は Ctrl+C（全プロセスを後始末）。ログは `/tmp/catharsis/`。

## 操作

| 操作 | 反応 |
|---|---|
| 長押し（〜3 秒で満充填） | 粒子集束 + ドローン上昇 + 心拍加速 |
| ドラッグしながら溜め | 溜め速度ブースト |
| 離す | 爆発（強度 = 溜めレベル） |
| 短クリック | 小破裂（連打向け） |
| `d` キー | デバッグ HUD（fps / state / level） |

## チューニング

体感調整の主要ノブ（すべて定数化済み）:

| 対象 | 場所 |
|---|---|
| マスター音量・リバーブ | `sc/main.scd` 冒頭の `~masterVolume` / `~reverbMix` / `~reverbRoom` / `~reverbDamp`（ライブ調整は `~master.set(\amp, 0.8)` 等） |
| シャワーの密度・長さ | `sc/main.scd` の `/release` OSCdef 内 `baseDensity`（level→3..14 notes/sec）と `total = 3.0` |
| ワンショット音量 | `\dropBoom` / `\shockwave` の amp マッピング、`\shimmer` の amp 係数 |
| 溜め/減衰テンポ・粒子数・演出強度 | `processing/CatharsisField/CatharsisField.pde` 冒頭の定数群（`CHARGE_DURATION_MS` / `DECAY_DURATION_MS` / `PARTICLE_COUNT` ほか） |
| パターン層の音量・追従感度 | `tidal/performance.tidal` 各レイヤーの `gain` / `lpf` / `degradeBy` の係数 |

## 依存セットアップ

構築手順の詳細と判断記録は [docs/process-log.md](docs/process-log.md) を参照。

1. `brew install --cask supercollider processing`
2. oscP5: [sojamo/oscp5 releases](https://github.com/sojamo/oscp5/releases) の zip を `~/Documents/Processing/libraries/` に展開
3. （Tier 2）`brew install ghc cabal-install && cabal update && cabal install tidal --lib`
4. （Tier 2）SuperDirt quark: `sclang` で `Quarks.install("SuperDirt")`
