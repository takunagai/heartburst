# CatharsisField ─ アーキテクチャ・OSC プロトコル仕様

インタラクティブ・アート作品「CatharsisField」の設計正本。実装（Processing / SuperCollider / Tidal Cycles）はすべて本書の仕様に従う。仕様変更は必ず本書を先に更新する。

## コンセプト

**溜めて解放（Charge & Release）**。マウス長押し・ドラッグで緊張を蓄積し、離した瞬間に爆発させる。カタルシス解消を全感覚（視覚・聴覚・操作感）で体感させる。

- ビジュアルトーン: ダーク＋ネオン（黒背景、シアン〜マゼンタの発光粒子、加算合成）
- 音響: チャージドローン上昇 + 心拍 → サブベース・ドロップ + 衝撃波 + 残響シャワー
- 連打の快感も副次的にサポート（短い溜めでも小気味よい破裂）

## プロセス構成

```
┌─────────────────┐  OSC :57120   ┌──────────────────────┐
│   Processing     │ ────────────→ │  SuperCollider        │
│  CatharsisField  │               │  sclang + scsynth     │
│  (視覚 + 入力)    │ ←──────────── │  カスタム SynthDef     │
└─────────────────┘  OSC :12000   │  + SuperDirt          │
        │                          └──────────────────────┘
        │ OSC :6010                          ↑ SuperDirt (:57120 内部)
        ▼                                    │
┌─────────────────┐        ┌────────────────┘
│  Tidal Cycles    │ ───────┘ (dirt メッセージ)
│  パターン層       │
└─────────────────┘
```

| プロセス | 役割 | 受信ポート |
|---|---|---|
| Processing | 粒子ビジュアル、マウス入力、状態機械の主管 | 12000 (UDP) |
| SuperCollider (sclang) | ワンショット音響（チャージ/ドロップ/シャワー）、SuperDirt ホスト | 57120 (UDP) |
| Tidal Cycles (ghci) | 持続パターン層（心拍・グルーヴ・アンビエント） | 6010 (UDP, ctrl 入力) |

- 状態機械の正本は Processing 側に置く（入力の発生源のため）。音側は受けたメッセージに反応するだけにして責務を分離する。
- Tidal の ctrl 入力ポートは公式裏取り後に確定（暫定 6010）。

## 状態機械（Processing が主管）

```
idle ──mousePressed──→ charging ──mouseReleased──→ releasing ──(2〜4s)──→ decay ──→ idle
                          │  level = f(保持時間, ドラッグ距離) ∈ [0,1]
                          └─ 30Hz で /charge/level 送出
```

- `level` の成長: 保持時間ベース（約 3 秒で 1.0 到達、イージング付き）+ ドラッグ移動量でブースト
- 短時間（< 300ms）のクリックは「小破裂」扱い ─ 連打の快感用に軽量パスで処理

## OSC メッセージ仕様

### Processing → SuperCollider（→ localhost:57120）

| アドレス | 引数 | タイミング | 音響側の応答 |
|---|---|---|---|
| `/charge/start` | `x:f, y:f`（正規化 0..1） | mousePressed | チャージドローン起動（低音量から） |
| `/charge/level` | `level:f (0..1)` | charging 中 30Hz | ドローンのピッチ・LPF・音量を追従 |
| `/release` | `level:f, x:f, y:f` | mouseReleased | ドロップ + 衝撃波 + シャワー（強度 = level） |
| `/pop` | `x:f, y:f` | 短クリック | 軽いプラック単発 |

### Processing → Tidal Cycles（→ localhost:6010）

| アドレス | 引数 | 意味 |
|---|---|---|
| `/ctrl` | `"charge":s, level:f` | 溜めレベル。心拍密度・フィルタに写像 |
| `/ctrl` | `"energy":s, energy:f` | 解放後エネルギー。グルーヴ密度に写像（減衰は Processing 側で 30Hz 送出） |

※ `/ctrl` の正確なアドレス・型は公式裏取り結果で確定する。

### SuperCollider → Processing（→ localhost:12000）

| アドレス | 引数 | 用途 |
|---|---|---|
| `/sc/amp` | `amp:f (0..1)` | マスター振幅。粒子のグロー・背景の脈動に写像（30Hz） |

- 音→視覚のフィードバックはこの 1 本のみに絞る（疎結合維持。増やす場合は本書を先に更新）

## 音響設計（SuperCollider）

| SynthDef | 内容 |
|---|---|
| `\chargeDrone` | ノコギリ波 2 osc デチューン + サブサイン。level で基音 40→80Hz、LPF 200→4000Hz、心拍様の振幅 LFO（速度も level 追従）。`/charge/level` を `\level` バスに書き込み追従 |
| `\dropBoom` | サブベース・ドロップ。サイン 60→28Hz ピッチエンベロープ、4〜6 秒減衰。強度 = level |
| `\shockwave` | ホワイトノイズ + BPF スイープ（8kHz→200Hz、0.6 秒）。空気の壁感 |
| `\shimmerRain` | ペンタトニックのプラック（Pluck/FM）を Pbind でばら撒く。密度は level に比例し 3 秒で減衰。広いリバーブ |
| `\popPluck` | 短クリック用の軽いプラック単発。ピッチはランダムペンタトニック |

- マスターに `Limiter.ar`（クリップ防止）と共有リバーブバスを置く
- `/sc/amp` は master バスの `Amplitude.kr` を SendReply で 30Hz 送出

## ビジュアル設計（Processing）

- 粒子 3000〜5000 個、`blendMode(ADD)`、黒背景（#050508）、シアン (#00E5FF)〜マゼンタ (#FF2BD6) の HSB 補間
- **idle**: パーリンノイズのフローフィールドで漂う。低輝度
- **charging**: カーソルへ引力（level で強化）、軌道収縮・ジッター増加・輝度上昇。画面周辺は暗くヴィネット
- **releasing**: 全粒子へ radial インパルス（速度 ∝ level）、衝撃波リング（膨張する円、幅減衰）、1 フレームの白フラッシュ、軽い画面シェイク
- **decay**: 摩擦で減速し idle のドリフトへ回帰。`/sc/amp` でグロー脈動
- 60fps 維持を優先。粒子数は起動引数で調整可能にする

## ディレクトリ構成

```
visual-art/
├── README.md                 # 起動手順
├── docs/
│   ├── architecture.md       # 本書（設計正本）
│   └── process-log.md        # 工程ログ（スキル化素材）
├── processing/
│   └── CatharsisField/
│       ├── CatharsisField.pde   # メイン・状態機械
│       ├── Particle.pde         # 粒子
│       ├── Shockwave.pde        # 衝撃波リング
│       └── OscBridge.pde        # OSC 送受信（oscP5）
├── sc/
│   └── main.scd              # SynthDef + OSCdef + SuperDirt 起動
├── tidal/
│   └── performance.tidal     # パターン定義
└── bin/
    └── start.sh              # 一括起動
```

## 依存

- SuperCollider 3.14.1（brew cask、公式 DMG 由来）
- Processing 4.5.5（brew cask、公式 DMG 由来）+ oscP5 ライブラリ
- Tidal Cycles（Haskell/cabal ─ 導入手順は裏取り後に確定）+ SuperDirt quark
- SuperDirt 未導入でも SC カスタム SynthDef のみで動作すること（Tidal 層はオプショナルなエンハンス）

## 段階的起動（フォールバック設計）

1. **Tier 1**: Processing + SC カスタム SynthDef のみ ─ コア体験成立（必須）
2. **Tier 2**: + SuperDirt + Tidal パターン層 ─ 持続層が加わり完成形

統合テストは Tier 1 を先に通し、Tier 2 を積む。
