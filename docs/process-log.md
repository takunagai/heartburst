# 工程ログ ─ CatharsisField（スキル化素材）

インタラクティブ・アート作品を 1 本作り上げる工程の記録。後日スキル化する際の正本。各フェーズで「やったこと・判断・ハマりどころ」を残す。

## Phase 1: 環境構築（2026-07-13）

### やったこと

1. 既存環境確認: `which sclang scsynth processing-java` + `/Applications` 走査 ─ 両方未導入と判明
2. 導入路の裏取り（P1 ルール: 導入系は一次情報確認後に実行）
   - `brew info --cask supercollider processing` で cask 存在・バージョン確認
   - SuperCollider 公式 downloads ページを fetch ─ 公式最新 3.14.1 = cask と一致
   - processing.org は WebFetch 403 → cask の .rb ソースを直接確認し、両 cask とも**公式 GitHub リリースの署名済み DMG** を取得していることを確認（supercollider/supercollider、processing/processing4）
3. `brew install --cask supercollider processing` をバックグラウンド実行（並行作業のため）
4. 検証: `sclang -v` → 3.14.1 OK。Processing.app 配置 OK

### 判断

- brew cask は公式サイト非掲載だが、取得物が公式リリース資産そのものなので採用（バージョン管理・アンインストールが楽）
- インストール待ち時間にコンセプト決定を並行（AskUserQuestion）

### ハマりどころ

- processing.org が WebFetch に 403 を返す → cask ソース確認で代替裏取り

## Phase 2: コンセプト決定（2026-07-13）

- コア・インタラクション 3 案（溜めて解放 / 弾けるオーブ / 流体を撫でる）を ASCII プレビュー付きで提示 → **溜めて解放**採用
- ビジュアルトーン → **ダーク＋ネオン**採用
- 教訓: 美的方向は作品の核なので、実装前にユーザー確認必須。それ以外（技術選定の詳細）は自律判断で進めて良い

## Phase 3: アーキテクチャ設計（2026-07-13）

- `docs/architecture.md` を**実装前に**確定（サブエージェントへの契約書）
- 要点:
  - 状態機械の正本は入力発生源の Processing に一元化（音側は反応するだけ）
  - OSC アドレス・ポート・引数型を表で固定 → 並行実装しても結合部が破綻しない
  - Tier 1（Processing+SC のみで成立）/ Tier 2（+Tidal）のフォールバック設計 ─ 依存の重い Tidal を非必須化してリスク遮断
- 途中でユーザーから Tidal Cycles 追加要望 → パターン層として位置づけ、ctrl 入力（OSC）で疎結合に統合

## Phase 1b: 追加環境構築 ─ Tidal / SuperDirt / oscP5（2026-07-13）

### 裏取り結果（explorer 委譲）

- Tidal ctrl 入力: **127.0.0.1:6010、アドレス /ctrl、typetag "sf"（キー名 + float）**、パターン側は cF/cS/cI で受ける ─ 設計の暫定仕様と一致、確定
- 公式推奨は tidal-bootstrap（1 コマンド）だが、SuperCollider 再導入 + Pulsar エディタまで抱き込むため**手動路を採用**: GHC + cabal + `cabal install tidal --lib` + SuperDirt quark
- headless 起動 `ghci -ghci-script BootTidal.hs` は公式 doc に明記なし（コミュニティ情報源）。統合フェーズで実測検証する

### やったこと

1. `brew install ghc cabal-install` → GHC 9.14.1 + cabal 3.16.1（公式 GHCup 路の代替。到達状態＝動く ghc+cabal は同じ）
2. SuperDirt quark: headless インストールスクリプト（scratchpad の .scd を sclang に渡す）で導入 ─ SuperDirt + Dirt-Samples + Vowel 取得確認
3. oscP5: Processing 4.5 の CLI（`Processing contributions`）はライブラリ導入非対応（examples のみ）と判明 → 作者公式 GitHub リリース（sojamo/oscp5 v2.0.4）の zip を `~/Documents/Processing/libraries/` に手動配置（netP5 は 2.x で oscP5.jar に同梱）
4. `cabal update && cabal install tidal --lib` 実行（GHC 9.14 は最新すぎて tidal の依存が未対応の可能性 → 失敗時は brew の旧版 GHC へフォールバック）

### ハマりどころ・学び

- Processing 4.5 に公式 CLI がある（`Processing cli --sketch=<dir> --run/--build`）─ ビルド検証を自動化できる。sketchbook パスは `Processing sketchbook list` で取得（本環境: ~/Documents/Processing）
- SuperDirt の quark インストールは sclang に .scd を渡すだけで headless 完結（IDE 不要）

## Phase 4: 実装（並行・サブエージェント委譲）

- SC 音響 → opus サブエージェント / Processing ビジュアル → sonnet サブエージェント（契約書 = architecture.md）
- Tidal パターン（tidal/performance.tidal）は Fable がメインセッションで直接執筆（ユーザー指示: Fable は Tidal が得意）
  - 設計: heartbeat（charge 追従で 50→175bpm 相当）/ groove（energy 減衰で degradeBy 崩壊）/ afterglow（アルペジオ余韻）/ ambient（常時床）の 4 レイヤー
  - cF は制御パターンとしてイベント単位でサンプルされる。fast へ渡すときだけ `realToFrac <$> segment 1 (...)` で Pattern Time 化

## Phase 5: 統合テスト・初回チューニング（2026-07-13）

### 検証結果

- tidal 1.10.3 は GHC 9.14.1 + cabal `install tidal --lib` で問題なく導入（公式 doc の 2 ページ間でコマンド表記が食い違っていたが `--lib` 形式が現行）。BootTidal.hs は cabal store（`~/.local/state/cabal/store/.../share/`）から発見しリポジトリにコピー
- headless 起動 `ghci -ghci-script BootTidal.hs -ghci-script performance.tidal` は実測で動作（コミュニティ情報が正しかった）。6010 待受・SuperDirt 接続・パターン読込エラー 0 を確認
- SC 単体の音出しは OSC 注入スクリプト（bin/test-osc.scd）で自動検証: /sc/amp 919 パケット・最大振幅 0.606・エラー 0
- フルスタック起動（bin/start.sh）で 3 プロセス同時稼働を確認

### 発見したバグと修正

- **alpha レンジ不整合（重要）**: `colorMode(HSB, 360, 100, 100, 100)` なのに粒子・フラッシュ・衝撃波の alpha が 255 前提の値（45〜230）→ 100 で頭打ち＝ほぼ不透明。加算合成で蓄積し「背景の灰色浮き・白飛び・マゼンタ不明瞭」を引き起こしていた。alpha 値を 100 レンジに再設計 + トレイルのフェードを強めて解決。**教訓: Processing で colorMode のレンジ指定と描画時の alpha 値は必ず突き合わせて検査する（サブエージェント成果物の頻出バグポイント）**

### 自動化の限界（スキル化時の注意）

- マウス合成（cliclick）は Accessibility 権限、screencapture は画面収録権限が必要 ─ TCC 権限はユーザーにしか付与できないため、「操作→演出」の自動 E2E は権限が既に付与された環境でのみ組み込める。権限なしでも「OSC 注入（音側）+ スクリーンショット（描画側）」で大部分は検証可能
- 音出しテスト前に `osascript -e 'set volume output volume 40'` で音量を絞り、終了後に復元する（BT スピーカー・耳の保護。元音量の退避を忘れない）
- 生成画像・スクショの提示は Artifact（data URI 埋め込み）で ─ 今回は初回起動レポートとして公開

### 統合で踏んだ運用バグ 2 件（スキル化時の必須知見）

- **ghci は stdin EOF で終了する**: バックグラウンド起動した Tidal が「Connected to SuperDirt」直後に静かに死んでいた。ログにエラーが出ないため気づきにくい。対策: `tail -f /dev/null | ghci ...` で stdin を開きっぱなしにする（start.sh に恒久化）。プロセス起動後は必ず `pgrep` で生存確認まで行う ─ ログが正常でも死んでいることがある
- **Processing cli --run の JVM は runner が親**: `Processing cli --run` は JVM を debugger 接続（jdwp suspend=y）で起動する。親の CLI runner が死ぬと JVM が孤児化してウィンドウが無反応になる（「クリックしても動かない」の実原因）。起動スクリプトはフォアグラウンドシェル内 `&` ではなく、永続するバックグラウンド実行で立ち上げること

### パフォーマンス修正（解放時のカクつき・ユーザー報告）

- 症状: 溜め→解放でアニメーションが停止・スローモーション化
- 対処 2 点で解消（ユーザー確認済み・実測 52〜60fps）:
  1. `pixelDensity(1)` ─ retina の既定 pixelDensity(2) は 3024x1964 で約 2380 万ピクセル/フレームの描画になる。発光粒子は等倍で見劣りしない
  2. 粒子描画を `ellipse()` から `stroke + strokeWeight + point()`（GL ポイントスプライト）へ ─ P2D では大幅に軽い。**注意: stroke 状態が後続の rect/fill 描画に漏れるので、トレイル矩形・フラッシュ前に noStroke() を明示**
- 計測手段: draw() 内で 120 フレームごとに `[perf] fps=... state=...` を println → ログ grep で状態別 fps を定量確認（HUD はユーザー側、ログは AI 側の観測手段として両輪）

### Phase 6: ウェブ版移植（2026-07-13）

### 構成と分担

- 計画正本: `docs/web-port-plan.md`（技術対応表・5 フェーズ・AGPLv3 方針）
- Phase 1（Vite+TS+p5 scaffold、粒子移植）: sonnet 委譲 ─ AudioEngine インターフェースを契約にして音響と分離
- Phase 2（Web Audio 音響）+ Phase 3（Strudel）: Fable 直接実装
- Strudel 裏取り: explorer 委譲で AGPLv3 制約を事前検出 → ユーザー判断（ソース公開で続行）を実装前に確定できた

### ウェブ移植で踏んだ技術問題（スキル化必須知見）

1. **p5 v2 の FES が偽陽性で fps を殺す**: HSB 4 引数 stroke() を「Invalid input」と誤検知し毎フレーム 4000 件ログ → それ自体が最大のボトルネック。`p5.disableFriendlyErrors = true` を本番必須に
2. **pixelDensity(1) は createCanvas の後**: p5 v2 では前に呼ぶと無効（retina 4 倍ピクセルのまま）。canvas.width の実測で検証する
3. **Web Audio の DelayNode フィードバックループは最小 128 サンプル**: 約 344Hz 超の Karplus-Strong が物理的に組めない（ペンタ音列ほぼ全滅）+ ループ内 BiquadFilter が不安定警告。**KS は起動時に JS でオフライン合成して AudioBuffer バンク化**（音程正確・再生コスト極小・警告根絶）
4. **p5.noise はネイティブ Processing の noise() より桁違いに遅い**: 4000 粒子×60fps で idle が 30fps に落ちる。粒子ごとに 4 フレームに 1 回の再計算（スロット分散）+ lerp 平滑化で視覚品質を保ったまま 1/4 に削減
5. **analyser 読み出し（getAmp）は毎フレーム 1 回に巻き上げ**（粒子ごと 4000 回呼んでいた ─ /simplify の指摘パターンの再発。契約：ループ不変値はループ外へ）
6. **Strudel worklet は initAudioOnFirstClick では間に合わない**: ゲートのクリックは消費済みなので「次のクリック」を待ち続け AudioWorkletNode エラー。ユーザー操作後なら `initAudio()` を明示 await
7. **fps 計測の罠**: 全状態でぴったり 30.0fps + long task ゼロ + フレーム間隔 33.3ms 均一 = 描画が重いのではなく **macOS/Chrome の省エネモードによる rAF 30Hz 制限**。フレーム予算計測（long task / フレーム間隔分布）で「重い」と「絞られてる」を区別する

### 検証手法（ウェブ版）

- chrome-devtools MCP で PointerEvent 合成 → ゲート突破・pop 連打・溜め→解放の全シーケンスを自動実行
- 音の実出力は `window.__catharsisAudio.getAmp()` のサンプリングで数値検証（pop 0.83 / charge 0.18 / release 0.59 / 減衰後 0.003）
- ビジュアルはスクリーンショットで状態別に確認（チャージ収束の白熱球・ヴィネット）

## Phase 7: ウェブ版公開（2026-07-13）

- Phase 4（sonnet 委譲）: 粒子数自動調整（fps 低下 + フレーム間隔の変動係数の両方で判定 ─ 省エネ rAF 制限と真の負荷を区別する設計を仕様に明記して委譲）、favicon data URI、OGP、AGPLv3 LICENSE、導入画面磨き、モバイル対策。委譲時に「判定の落とし穴」を仕様に書いたことで手戻りゼロ
- OG 画像: MCP スクショはツール間レイテンシで狙った瞬間を外す → **ページ内 `canvas.toDataURL()` で原子的にキャプチャ**し、データ量（base64 長）をプローブに解放後 250ms のピークを特定して撮影。1200x630 は sips で加工
- デプロイ: `wrangler deploy`（静的アセット構成）→ https://catharsisfield.autumn-wave-9579.workers.dev/ ─ 本番 E2E（ゲート→溜め→解放、amp 0.45、コンソールエラー 0）まで確認
- 学び: og:image は相対パスでなく絶対 URL（クローラ対応）。デプロイ後に URL が確定してから再ビルド・再デプロイの 2 段が素直

## Phase 8: スキル化（2026-07-13）

- `~/.claude/skills/interactive-art-builder/` を構築（計画正本: docs/skill-plan.md）
- 分担: SKILL.md + wizard.md + architecture-template.md = Fable / references 4 本 = sonnet（4 並列フォークで分担執筆）/ templates 8 本 = sonnet
- 委譲品質の学び:
  - 「書けなかった項目は憶測で埋めず明記せよ」の指示が機能 ─ verification.md の欠落 2 箇所（E2E スクリプト・amp リスナー実装）は親のセッション知識で正確に補完できた。**セッション内でしか知らない手順は正本ドキュメントに残しておくこと**（今回の还流でカバー）
  - templates の {{PLACEHOLDER}} は識別子位置で構文エラーになる → コードは有効識別子 + ヘッダーコメントで置換対象列挙、が正解
  - 並列フォークの入れ子は 1 段まで（"Fork is not available inside a forked worker"）
- 未実施: スモークテスト（新規ディレクトリでウィザード → 最小作品）。コンテキストの新鮮な別セッションで実施するのが計画どおり

## 未解決・保留

- 音の体感チューニング（音量バランス・ドロップの重さ・Tidal 混合比）はフィードバック駆動で随時。パラメータは全て定数化済み（README「チューニング」参照）
