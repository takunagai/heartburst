# interactive-art-builder スキル化計画

Heartburst 制作工程（`docs/process-log.md` 全 7 フェーズ）を一般化し、「ビジュアル × サウンド × インタラクション」の作品を対話から公開まで導くユーザースキルにする。

- スコープ: **インタラクティブ・アート全般**（感情ゴール駆動。カタルシスは 1 プリセット）
- プラットフォーム: **ウェブ（p5.js + Web Audio + Strudel）+ ネイティブ（SuperCollider + Processing + Tidal Cycles）両対応**
- ウィザード: **徹底型 3 ラウンド**（参照作品・パレット・音律・公開計画まで固めてから着手）
- 配置: `~/.claude/skills/interactive-art-builder/`（全プロジェクト共通）
- 名称は仮。候補: `interactive-art-builder` ⭐ / `art-experience-builder` / `synesthesia-builder`

## 1. 設計原則（今回の工程から抽出したベストプラクティス）

1. **美的判断はユーザー、技術判断は AI**: 体験の核・トーン・音の性格は必ず対話で確定。ライブラリ選定・実装方式は自律
2. **設計正本ファースト**: 実装前に architecture.md（状態機械・音視覚マッピング・プロセス間契約）を確定し、並行実装の契約書にする
3. **契約分離**: 視覚と音響はインターフェース（ウェブ: AudioEngine、ネイティブ: OSC 仕様表）だけで結合。サブエージェント並行実装が破綻しない
4. **Tier 設計**: コア体験（Tier 1）が単独で成立し、パターン層（Tier 2: Tidal/Strudel）はオプショナル。依存の重い層を非必須化してリスク遮断
5. **数値検証**: 「動いた気がする」を禁止。amp サンプリング・fps・フレーム間隔分散・OSC パケット数で裏取り
6. **定数一元化**: 全チューニングノブをファイル冒頭に集約 + README に一覧表。体感フィードバックを即反映できる形を保つ
7. **委譲仕様に落とし穴を明記**: 既知のハマりどころ（後述の知識ベース）を委譲プロンプトに書き込み、手戻りを予防
8. **工程ログ必須**: 各フェーズの判断・ハマりを作品リポジトリの docs/process-log.md に記録 → 新知見はスキルの pitfalls に還流（自己改善ループ）

## 2. アイデア具体化ウィザード（Phase 0・スキルの核）

### 対話プロトコル

- **AskUserQuestion を第一手段**とする。1 ラウンド = 1 呼び出し（最大 4 問）
- **フォールバック**: AskUserQuestion が使えない環境（他ハーネス・ヘッドレス）では同じ質問を**番号付きリスト**で提示し、「1」「2-b」等の回答を待つ。SKILL.md に両形式の指示を書く
- 全質問に **推奨⭐** と **「お任せ」**選択肢。コア操作の選択肢には **ASCII プレビュー**を付ける（今回の「溜めて解放」提示で実証済みの手法）
- 既にアイデアが固まっているユーザーには: 冒頭で自由記述を受け、埋まった項目のラウンドはスキップ（差分だけ質問）

### R1 ─ 体験の核

| 質問 | 選択肢例 |
|---|---|
| 感情ゴール | カタルシス解放 / 癒し・瞑想 / 快感・連打の気持ちよさ / 緊張と畏怖 / 驚き・発見 |
| コア操作（動詞） | 溜めて解放 / 撫でる・かき混ぜる / 弾く・割る / 育てる・枯らす / 引き寄せと反発 ─ 感情ゴールに応じて動的に絞り、ASCII プレビュー付き |
| 参照作品・イメージ | 自由記述（「なし」可。作品名・URL・「深海」「花火」等の言葉でよい） |

### R2 ─ 感覚の設計

| 質問 | 選択肢例 |
|---|---|
| ビジュアルトーン | ダーク＋ネオン / 白ミニマル / 有機グラデーション / レトロ CRT / モノクロ＋単色差し |
| カラーパレット | トーンに応じた具体 2〜3 案（hex 提示。例: シアン×マゼンタ / アンバー×ティール） |
| 音の性格 | 電子シンセ / アンビエント・ドローン / ノイズ・インダストリアル / アコースティック風 / チップチューン |
| 音律・スケール | マイナーペンタトニック⭐ / メジャーペンタ / ドリアン / リディアン / 無調・ノイズ主体 |

### R3 ─ 実装と公開

| 質問 | 選択肢例 |
|---|---|
| プラットフォーム | ウェブ⭐（共有容易・環境構築軽い） / ネイティブ（低レイテンシ・高音質・展示向け） / 両方（ネイティブで作り込み→ウェブ移植） |
| 入力デバイス | マウス・タッチ⭐（v1 サポート範囲） / マイク・カメラ等は将来拡張と明示 |
| 公開計画 | ローカルのみ / Cloudflare Workers 公開（+OGP・共有画像） / GitHub ソース公開も |
| 規模・性能目標 | 粒子数の目安と 60fps 目標、モバイル対応の要否 |

### 出力: コンセプトシート

回答を `docs/concept.md` に整形（作品名候補 3 案付き）→ **ユーザー承認** → Phase 1 へ。承認前に実装しない。

## 3. ワークフロー全体（SKILL.md の骨格）

```
Phase 0 ウィザード        → concept.md（承認ゲート）
Phase 1 環境構築          → プラットフォーム別チェックリスト。導入系は一次情報裏取り必須
Phase 2 設計正本          → architecture.md（テンプレから生成。状態機械・マッピング表・契約・Tier）
Phase 3 実装（並行委譲）   → 視覚 = sonnet / 音響 = opus / パターン層(Tidal/Strudel) = メイン直書き
Phase 4 統合・自動検証     → E2E 合成イベント・数値検証・スクリーンショット
Phase 5 体感チューニング   → 成果物を必ず目視/耳で確認できる形で提示（open / Artifact / 公開 URL）→ フィードバックループ
Phase 6 公開（任意）      → deploy・OGP・ライセンス確認（AGPL 系依存の自動検出と確認）
Phase 7 工程ログ・還流     → process-log.md 記録、新規ハマりどころをスキル pitfalls へ追記提案
```

## 4. スキルのディレクトリ構成

```
~/.claude/skills/interactive-art-builder/
├── SKILL.md                     # トリガー・ワークフロー・対話プロトコル・委譲方針（薄く保つ）
├── references/                  # progressive disclosure（必要フェーズでのみ読む）
│   ├── wizard.md                # 3 ラウンド質問バンク・ASCII プレビュー素材・番号リスト形式・concept.md 雛形
│   ├── architecture-template.md # 設計正本雛形（状態機械 / 音視覚マッピング表 / AudioEngine・OSC 契約 / Tier）
│   ├── stack-web.md             # p5+WebAudio+Strudel 実装ガイド + ウェブ固有ハマり
│   ├── stack-native.md          # SC+Processing+Tidal 実装ガイド + 環境構築 + ネイティブ固有ハマり
│   ├── verification.md          # 検証ハーネス（PointerEvent 合成 E2E / amp / fps 判別 / OSC 注入 / toDataURL 撮影）
│   └── pitfalls.md              # 統合知識ベース（下記 5 節）
└── templates/
    ├── web/                     # AudioEngine 契約 / エンジン骨格 / Strudel signal 注入 / scaffold 手順
    └── native/                  # main.scd 骨格 / OscBridge.pde / start.sh / test-osc.scd
```

- テンプレは**骨格**（構造・契約・コメント）に留め、フルコードは `~/Projects/Game/heartburst` を参照実装としてパス記載（ローカル利用前提のユーザースキルなので有効。消えてもテンプレだけで動く二段構え）
- スキルディレクトリに生成物を置かない（全プロジェクト共通規約どおり）

## 5. 焼き込む知識ベース（pitfalls.md ─ 今回の実証済み知見）

**Processing/p5**: colorMode レンジは alpha にも効く / p5 v2 FES 偽陽性が fps を殺す（disableFriendlyErrors） / pixelDensity(1) は createCanvas 後 / p5.noise は遅い→分散更新 / ループ不変値の巻き上げ（色キャッシュ・getAmp）
**Web Audio**: DelayNode ループ最小 128 サンプル→KS はオフライン合成バンク / 生成 IR リバーブ / autoplay はクリックゲートで演出化 / Strudel worklet は initAudio() 明示
**SuperCollider**: 入出力サンプルレート不一致→ numInputBusChannels=0 / SuperDirt はクラス存在ガードで動的参照 / quark の headless インストール
**プロセス運用**: ghci は stdin EOF で死ぬ（tail -f /dev/null パイプ） / Processing cli の JVM 孤児化 / 音出しテスト前のシステム音量退避・復元
**検証**: ぴったり 30fps + 間隔均一 = rAF 制限であって負荷ではない / MCP スクショはレイテンシで瞬間を外す→canvas.toDataURL / 提示は Artifact か open（Read は不可視）
**ライセンス**: Strudel は AGPLv3（組込側もソース公開）─ 公開計画の質問時に自動で告知

## 6. 実装ステップ（スキル自体の構築）

| # | 作業 | 担当 | 完了条件 |
|---|---|---|---|
| 1 | SKILL.md + wizard.md（対話 UX が核） | Fable | frontmatter・トリガー・3 ラウンド完記 |
| 2 | stack-web.md / stack-native.md / verification.md / pitfalls.md | sonnet 委譲（正本 = process-log 等の事実リストを渡す） | 正本との突合レビューを Fable が実施 |
| 3 | templates/ 抽出（実装から骨格化） | sonnet 委譲 | 骨格が単体でコンパイル可能（型・構文チェック） |
| 4 | architecture-template.md | Fable | Heartburst の architecture.md を汎化 |
| 5 | スモークテスト: 新規空ディレクトリでスキル起動 → ウィザード完走 → 最小作品（ウェブ Tier 1）が鳴って動く | Fable + 検証ハーネス | E2E 数値検証パス + ユーザー体感確認 |
| 6 | 番号リスト・フォールバックの動作確認（AskUserQuestion を使わない指示で再走） | Fable | 対話が破綻しない |

見積り: 実装 1 セッション + スモークテスト 1 セッション。

## 7. DoD

- [ ] 新規ディレクトリで「インタラクティブアート作りたい」からウィザード → concept.md → 動く最小作品まで無介入区間が成立
- [ ] AskUserQuestion 環境と番号リスト環境の両方で対話が機能
- [ ] ウェブ・ネイティブ両ルートで Phase 1〜4 の手順が references から再現可能
- [ ] pitfalls.md の全項目に「症状 → 原因 → 対処」の 3 点セット
- [ ] スキル実行後、工程ログ還流の提案が自動で出る
