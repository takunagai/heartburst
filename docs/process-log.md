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

## Phase 9: 改良企画（2026-09-23）

- 起点: ユーザー所感「動作はするが感動や面白さがない」。計画正本は docs/improvement-plan.md
- やり方: 実装コードを読んで原因を 8 項目に分解（満充填で頭打ち／解放に間がない／爆発粒子の端ワープ／小型スピーカーで低音不可聴／ビート非同期／何も残らない／idle の誘いなし／グローなし）→ 4 軸（爽快感・ゲーム性・楽器・物語）× S/M/L 工数で案を列挙 → AskUserQuestion で軸・描画基盤・対象・デバイスを確定
- 判断: 4 軸すべて採用。ウェブ版のみ・p5 2D 継続・PC + スマホ両対応。爽快感コア（解放の瞬間）を最初のフェーズに置く ─ 他の 3 軸はすべて「解放」の手応えの上に乗るため
- 学び（スキル還流候補）: 「動くが面白くない」は機能不足ではなくゲームフィールの欠落として診断すると案が具体化する。観点は「溜めの段階性／解放前の間（予備動作・無音）／音楽との同期／結果の変化と蓄積／触る前の誘い／再生環境（小型スピーカー）」

## Phase 9-1: 爽快感コア（2026-09-23）

- 実装（ウェブ版のみ・ネイティブ版は旧仕様のまま）:
  - 状態機械を `idle → charging → inhale → impact → decay` に拡張。着弾時刻は音響側が決めて返す（`release()` が `ReleaseTiming` を返す契約に変更）→ ビジュアルはその時刻まで吸い込みで待つ。音と絵の同期の主導権を音側に置いたのが要点
  - 描画: 速度ストリーク、爆発中の端ワープ停止と端からの再流入、3 層衝撃波と波面による押し出し、色温度（白熱 → 全色相 → 復帰）、ヒットストップ + スローモーション（物理に timeScale、摩擦は `FRICTION ** timeScale`）、ばねズーム、グロー
  - 音: ライザー + 拍に揃った加速スネアロール、着弾前の全体ダッキング（無音の間）、次の 16 分への量子化、着弾音の帯域別多層化（click / body / exciter / sub）、1〜2 小節のドロップ区間（キック + 裏拍ベース + Strudel 層のポンピング）
- ハマりどころ・判断:
  1. **Strudel の拍位置は公開 API に無い**: `initStrudel()` の戻り値（repl）の `scheduler`（Cyclist）が持つ `num_cycles_at_cps_change` / `seconds_at_cps_change` / `cps` / `latency` から、Cyclist 自身の発音時刻式 `(cycle - n0) / cps + s0 + latency` で換算できる。内部フィールドなので欠損時は自前クロック（同じ cps）へ退避
  2. **Strudel 層にもダッキングを掛けるには出力を奪う**: `getSuperdoughAudioController().output.destinationGain` を `ctx.destination` から外して自前のマスター系統へ繋ぎ直す。これで無音の間・ポンピング・analyser（getAmp）が Strudel 層にも効く
  3. **グローを本体キャンバスへ加算するとトレイルと帰還ループになる**（前フレームの光を毎フレーム再加算して白飽和）。縮小キャンバスを別 DOM レイヤーにし CSS `mix-blend-mode: screen` で重ねる。拡大補間そのものがぼかしになるので `ctx.filter` 非対応環境でも成立する
  4. **粒子描画は p5 の stroke() を経由しない**: 色を量子化して rgba 文字列をキャッシュし、2D context に直接 moveTo/lineTo。長さ 0 の線は描かれない環境があるため点は 0.01px の線 + round cap
  5. **rAF をラップしても p5 の draw 時間は測れない**（p5 は起動時の参照を使う）。draw 内で処理時間の指数移動平均を取り `__catharsisDebug()` に出す方式にした
- 検証（chrome-devtools・PointerEvent 合成）: 着弾時刻が 16 分グリッド上（cycle 7.625）、状態遷移 inhale 235ms → impact 102ms → decay、振幅は吸い込み中 0 → 着弾 0.87 → 600ms 周期のキック 0.7〜0.78、draw 3.6〜5.3ms（M2 Max・4000 粒子。30fps 表示は省エネの rAF 制限）、弱い解放は量子化・ドロップなし、ドロップ中の溜め直しでドロップ停止、コンソールエラー 0
- 未検証: スマホ実機（小型スピーカーでの聞こえ方・描画負荷）、Safari の `ctx.filter`

## Phase 9-2: 溜めのドラマとゲーム性（2026-09-23）

- 実装: 段階チャージ（33/66/100% で輪・和音・揺れ・渦の強化、進行の円弧と心拍の脈動をポインタに表示）、オーバーチャージ（赤熱・稲妻・火花の噴出・Shepard トーン・放電ノイズ、満了で暴発）、クリティカル（心拍の位相 ±0.12 で金の爆発 + 鐘）、スリングショット（直前 70ms の弾き速度で指向性インパルス）、idle のホバー反応、スマホの振って解放と振動、二次爆発（花火の連鎖）、ドロップの拍に乗る輪と粒子の脈動、余韻の発光、背景の星雲
- 見た目の評価ループで直したもの（スクショ → 判断 → 修正を 5 周）:
  1. オーバーチャージ中は全粒子が核に潰れて画面が空 → 稲妻・火花の噴出・赤熱の核を追加
  2. 威力 1 超過を速度に掛けると全粒子が画面外へ抜けて 1 秒後に空洞 → 速度上乗せは 0.35 倍に抑え、派手さは二次爆発・色・輪で出す
  3. 減速した粒子が暗く小さくなり、ドロップ区間（最大 4.8 秒）が空虚 → 余韻の明るさを energy に連動、キックで粒子が脈打つ、きらめき
  4. idle が暗すぎて第一印象が弱い → 輝度・alpha 引き上げ + 背景の星雲
- ハマりどころ:
  - **p5 v2 は fill/stroke の値をキャッシュし、同じ色なら ctx へ再設定しない**。2D context へ直接 `fillStyle` を書くと次フレームの p5 描画に漏れる（トレイル消去の矩形が星雲グラデーションで塗られ画面全体が飽和）。直接描画は必ず `ctx.save()` / `ctx.restore()` で囲む
  - iOS のモーションセンサーは `DeviceMotionEvent.requestPermission()` をユーザー操作起点で呼ぶ必要がある → 導入ゲートのタッチで要求
- 検証: 段階到達 0.56 / 1.26 / 3.0 秒、暴発 5.6 秒（威力 1.35）、心拍直後の解放 = critical（1.12）、拍の中間 = normal、弾き = 指向性 0.77、draw 3.6〜4.5ms、コンソールエラー 0
- 未検証: スマホ実機（振って解放・振動・描画負荷）

## Phase 9-3: 楽器・音楽（2026-09-23）

- 実装: `src/music.ts`（音程・色・コード進行の共通定義）を新設。タップは位置で音程（x = C マイナーペンタの度数、y = オクターブ）が決まり、その場に「種」が残る。種は 1 小節 16 分割のループシーケンサーで鳴り続け、スロット順に星座の線で結ばれる。本波の波面が種に届くと誘爆し、その波が次の種を誘爆（連鎖。種の音が旋律として鳴る、6 連鎖で金の大輪）。強い解放ごとに Cm → A♭ → E♭ → B♭ と進み、シャワー・ドロップのベース・Strudel 層・星雲の色合いが追従
- 判断:
  - Strudel のパターンは `signal` で音程を動かすより、コードごとにコード文字列を生成して `evaluate()` し直す方が素直（スケジューラは止まらず次のクエリから効く。`setcps` が同値なら cps のリセットも起きない）
  - Karplus-Strong のバンクは周波数でなく MIDI 番号をキーにし、使う音域（自然短音階 2 オクターブ + タップ 15 音 × 2 減衰）だけ事前合成
  - 種の光は音と同じ時間軸（Strudel の拍換算から出力レイテンシを引いた「聞こえている位置」）でスロット通過を検出して点滅させる
- 検証: 種 9 個が 16 分スロットに配置・ループ再生、中央の解放で 9 連鎖（全誘爆）、コード Cm → A♭、コンソールエラー 0

## Phase 9-4: 感動・物語（2026-09-24）

- 実装: `src/scenes.ts`（場面 = 粒子の 2 色 + 星雲の 3 色 + 一文）を新設
  - 「言葉を書いて、壊す」: 右下の入口から入力 → オフスクリーンに描いた文字のピクセルを間引いて全粒子の半分に目標座標を割り当て、ばねで形作る。溜めで震え、着弾で砕ける。入力はブラウザ内のみ（送信・保存なし）
  - 痕跡: 強い解放のたびに半解像度の別キャンバスへ光の染み・輪・星屑を積み、毎フレーム加算で重ねる（自分の爆発の履歴が 1 枚の絵になる）
  - 大団円: 強い解放 7 回目は finale（場面色の多重波・痕跡の星屑から一斉に火花・金の二次爆発 16 発・駆け上がるアルペジオ + 和音パッド・4 小節ドロップ）。ヒットストップ明けに場面が次へ移り（夜 → 夜明け → オーロラ → 深海 → 夜）、一文が浮かぶ。画面下の 7 つの点で残り回数を示す
- 見た目の評価ループで直したもの:
  1. 言葉が細く弱い → 言葉の粒子だけ太く明るく
  2. **星雲の橙〜黄緑（15〜125°）は暗い低 alpha で茶色・オリーブに濁る**（夜明けが泥色になった）。場面の定義で避けるだけでは足りず、コード進行の色ずらしや爆発種類への色寄せで帯に入る → 最終色相を帯の外へ逃がす `avoidMuddyHue` を掛け、金への色寄せは星雲では行わない（金は粒子と輪で出す）
  3. 狭い画面（390px）で進行の点と「言葉」ボタンが重なる → 狭い画面では点を左下へ
- 堅牢化（agent-browser のヘッドレス検証で発覚）:
  - **`AudioContext.resume()` が解決しない環境で、未配線のノードへ connect して例外 → p5 の描画ループごと停止**（段階 1 到達で画面が固まる）。エンジンの各メソッドの防御を「ctx の有無」から「配線完了フラグ `isReady`」に変更
  - 導入ゲートで音声の起動を待つ間に指が離れていたら、溜めでなくタップとして処理（離し済みのまま charging に入ると次のタップまで抜けられない）
- 事故と教訓: chrome-devtools（普段使い Chrome）での長い検証中に選択中タブがユーザーの別タブへ移っており、モバイル表示の模擬と CPU スロットル・再読み込みをそのタブへ実行してしまった。状態を変える操作の前に `location.href` を確かめる。検証の操作は agent-browser（自前の Chrome for Testing）へ寄せる（memory: verify-selected-tab-before-devtools）
- 検証: 言葉 2000 粒子で形成 → 溜めで震え → 解放で砕けて 0、痕跡 138 点、7 回目で finale → 場面 dawn・一文「夜が明ける」・回数リセット、390×844 で描画 3.5ms・操作一巡でエラー 0（現行版）
- 未検証: 実機（iOS Safari / Android Chrome）の音・振って解放・振動・描画負荷、人間の耳での音量バランス

## Phase 9-5: 粒子の住む範囲を真円に（2026-09-24）

- 起点: ユーザー指摘「パーティクルがモニタの矩形の形で堰き止められる。画面外まで伸びる真円にしたい」。溜めると画面の四辺がそのまま縮み、直線の縁・蝶ネクタイ形が見えていた
- 原因: 粒子の配置・回り込み（wrapEdges）・爆発後の再流入（矩形の辺から）がすべて画面の矩形基準
- 実装（ユーザー選択: 半径 = 対角線の半分 × 1.4、粒子数を増やす + 中心ほど濃く）:
  - 住む範囲を画面中心の真円に。配置は半径 = R × 乱数^0.7（中心ほど濃い）、円外へ出たら中心を挟んだ反対側の円周の内側へ、爆発後は円周から内向きに再流入（円周は画面外なので出入りが見えない）
  - idle 中は縁ほど中心へ寄せる弱い流れ（フローで外へ散っても中心の濃さを保つ）
  - 粒子数 4000 → 8000、画面外（余白 80px の外）の粒子は描画を省いて計算だけ。自動削減の段は 8000 / 5000 / 3000
- 効果: 溜めは四方から途切れず吸い込まれる円形の渦に、爆発は円形の輪に。画面内に映る粒子は約 4200（旧 4000 と同等）で、3 分間の放置でも 4000〜4400 に収まる（中心への寄せ過ぎ・散り過ぎなし）。draw は idle 4.0ms / 溜め 6.3ms（ヘッドレス 1440×900）

## Phase 9-6: スマホで無音の修正（2026-09-24）

- 症状（ユーザー実機報告）: スマホで音が全く出ない。PC は鳴る
- 原因: HTML の user activation は、タッチだと pointerup / touchend で成立し、**pointerdown では成立しない**（マウスは pointerdown で成立）。導入ゲートが pointerdown で `AudioContext.resume()` し、その解決を `await` していたため、スマホでは ctx が suspended のまま（Strudel も起動しない）
- 再現と確認: agent-browser の Chrome に CDP で直接つなぎ、`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent` で本物のタッチを送るスクリプトで実測。修正前 = touchStart 後も touchEnd 後も suspended・振幅 0。修正後 = touchEnd で running・Strudel 起動・溜め 0.166 / 解放 0.310。マウス経路も押下時点で running（回帰なし）
- 修正:
  - `start()` は `resume()` を待たずに配線を済ませ、pointerup / touchend / click / keydown のたびに止まっていれば再開する常駐リスナーを置く（iOS の着信・バックグラウンド復帰で止まった場合もこれで戻る）
  - Strudel は `statechange` で running になってから起動
  - iOS の消音スイッチ対策に `navigator.audioSession.type = "playback"`（Safari 16.4+、非対応なら何もしない）
- 残る仕様: スマホでは最初の長押し（導入ゲート）の間は無音で、指を離した瞬間から鳴る（ブラウザの仕様上、最初の音は指を離すまで出せない）
- 学び（スキル還流候補）: Web Audio の解錠は「マウスは押下、タッチは指を離した時」。ゲートを pointerdown で作るならタッチ用に pointerup / touchend でも resume() を呼ぶ。検証は PC のマウスだけでは通ってしまう

## Phase 9-7: iPhone で無音の真因（2026-09-24）

- 9-6 の修正後も iPhone（iOS 18.7・LAN の http）で全く無音。推測で直すのをやめ、`?debug` の実機診断表示（音声の状態・https か・消音対策・直近のエラー）を入れて iPhone で見てもらった
- 診断結果: `contextState: not created` + `ReferenceError: Can't find variable: DeviceMotionEvent` ─ **iOS Safari は https でないページに `DeviceMotionEvent` 自体を公開しない**。導入ゲートが音声の起動より先に「振って解放」の許可要求を呼び、その中の参照で例外 → 音声の起動が 1 行も実行されていなかった
- 修正: `typeof DeviceMotionEvent === "undefined"` なら何もしない、許可要求はユーザー操作として通る touchend で呼ぶ（pointerdown はタッチでは user activation にならない）。Chromium で `delete window.DeviceMotionEvent` した上で CDP の本物のタッチを送り、起動 → running → 溜め・解放で発音を確認
- 同時に入れた保険: Audio Session API が使えない環境（http・古い iOS）では無音の `<audio>` を鳴らし続けて消音スイッチを回避
- 学び（スキル還流候補）:
  - **実機でしか起きない不具合は、推測の修正を重ねる前に画面へ診断を出す**（9-6 は仮説が 1 つ外れていた。診断 1 回で真因に届いた）
  - セキュアコンテキスト限定の API（DeviceMotionEvent・AudioWorklet・audioSession 等）は LAN の http 検証で消える。参照は typeof で守り、ユーザー操作のハンドラでは例外が後続を巻き込まないよう、重要な処理（音声の起動）を先に置く

## Phase 9-8: 起動時の待ち時間の解消（2026-09-24）

- 症状（ユーザー実機報告）: iPhone で音が出るようになった代わりに、ロード時に数秒の待ちが出た（音声の起動に初めて到達したことで、その重さが表に出た）
- 計測: CDP の `Emulation.setCPUThrottlingRate`（4 倍）+ `Page.addScriptToEvaluateOnNewDocument` で longtask を読み込み直後から記録し、本物のタッチで導入ゲートを押す
  - 読み込み 377ms: 画面端を暗くする画像の生成（全ピクセルで p5 の map/constrain）+ 8000 粒子の生成（粒子ごとの p5.lerpColor）
  - タップ直後 353ms + 171ms ほか: Karplus-Strong 45 音の一括合成 + Strudel の読み込み・パース
- 対処:
  - 画面端の暗さは canvas の放射グラデーションで生成し、描画も p5 の tint でなく drawImage + globalAlpha
  - 粒子の彩度・明度は p5.lerpColor の結果を 64 段の表にして引く（見た目は旧実装と同値）
  - KS は 1 音ずつ setTimeout で合成（タップ音 → 和音・シャワー → 種の順）、未合成の音は要求時にその場で合成。ホットループの剰余を分岐に置換
  - Strudel は導入画面の表示中（起動 0.8 秒後）に import だけ先読み
- 結果（4 倍スロットル）: 読み込み 377 → 69ms、タップ後は最大 69ms（すべて 70ms 未満に分散）。音・色・画面端の暗さは回帰なし
- 学び（スキル還流候補）: 「起動が重い」は体感で探さず longtask を計測する。事前合成・事前生成は「使う順に小分け + 要求時フォールバック」にすれば、起動時の一括処理を無くせる

## Phase 9-9: 声で溜める（E3・2026-09-24）

- 実装: 右下に「声で溜める」（任意・https / localhost のみ表示）。マイクの RMS を dB にして -50〜-12dB を 0..1 に写し（立ち上がり速く・減衰ゆっくり）、
  - 声だけ: 声量 0.35 が 120ms 続くと画面中央で溜め開始 → 声量^1.2 を積み上げて溜まる（大声で約 1.5 秒で満充填）→ 0.15 未満が 280ms 続くと解放。叫び続ければオーバーチャージ → 暴発
  - 長押しと併用: 声量ぶん溜めが加速
  - 叫んでいる間は核が膨らみ画面が震える。ボタン下端に声量メーター
  - 自分の爆発音で再発動しないよう、エコーキャンセル + 爆発後 1.5 秒は声の溜めを受け付けない。自動ゲインは声の強弱を潰すので切る
  - マイクの音は出力へ流さず（無音のゲインで出力に繋ぐのは、未接続ノードを処理しないブラウザ対策）、音量の計測にだけ使う
- 構造: 溜めの中心を `chargeX/Y` に分離（ポインタで溜めるとポインタ追従、声で溜めると画面中央固定）し、`beginCharging(source)` に共通化
- 検証の工夫: ヘッドレスの Chrome for Testing では偽マイク（`--use-file-for-fake-audio-capture`）に音声が流れなかった（処理を全部外しても 0）。マイクの接続（トラック live・analyser 接続）までを実機相当で確かめ、判定ロジックは `getVoiceLevel` を台本の声量に差し替えて状態遷移を追跡した: 声 → 溜め（段階 1〜3）→ 沈黙 → 吸い込み → 爆発 → 余韻中の再発動まで確認
- ハマり: agent-browser は既存デーモンがあると `--args` 付き起動が「Could not configure browser」で失敗する → `--session <新しい名前>` で別デーモンを立てる
- 未検証: 実際の人の声での感度（-50〜-12dB の範囲・開始 0.35 が適切か）、iPhone での録音時の出力音量低下（iOS はマイク使用中に音声セッションが録音兼用になり、出力が小さくなることがある）

## Phase 10: main へマージ・本番デプロイ（2026-09-24）

- `feat/phase9-1-catharsis-core` を main へ早送りマージ（リモート未設定のため push なし）→ `pnpm build` → `wrangler deploy`
- **workers.dev のサブドメインが変わっていた**: デプロイ先の表示が旧 `catharsisfield.autumn-wave-9579.workers.dev` でなく `catharsisfield.nagai-shouten.workers.dev`。旧 URL は応答なし（curl 000）。同じ Worker のデプロイ履歴（2026-07-13〜）が続いているので、アカウントの workers.dev サブドメイン自体が変わったと判断。index.html の og:url / og:image を新 URL に直して再デプロイ
- 本番 E2E（agent-browser + CDP の本物のタッチ、390×844）: タッチで音声 running・Strudel 起動（https なので AudioWorklet も通る）・溜め 0.59 / 解放 0.58・「声で溜める」表示・8000 粒子・エラー 0
- ロールバック先: 旧版 `3240307b`（2026-07-13）。今回 `94ad0381`
- 学び: デプロイ前に `wrangler deployments list` で既存 Worker の所在を確かめ、デプロイ後は表示された URL と OGP の URL が一致しているかを必ず見る（サブドメインは外部要因で変わる）

## Phase 10-1: iPhone 実機（本番 https）の不具合 2 件（2026-09-24）

- ユーザー評価: 作品としては「満足。完成でよい」。iPhone で 2 件の不具合報告
- 「声で溜める」で「マイクが許可されていません」: https では Audio Session API が使えるため `type = "playback"`（消音スイッチ対策）にしていたが、playback のままでは iOS がマイク取得を拒否すると判断（推定。実機での再確認待ち）。マイク使用中だけ `"play-and-record"` に切り替え、オフ・失敗時に `"playback"` へ戻す
- 振ると「取り消す - 入力」モーダル: iOS 標準の「シェイクで取り消し」。「言葉を書いて、壊す」の入力履歴が残っていると、振って解放の動作で出る。入力を閉じるたびに入力欄を新しい要素へ差し替えた（効果なし ─ 下記）
- 本番へ再デプロイ（版 9306f2ee）
- 実機再確認: 「声で溜める」は動作（play-and-record への切り替えで解決）。「取り消す - 入力」は入力欄の差し替え後も出続けた → iOS は要素を消しても入力の履歴を持ち続ける。ユーザー選択で、iOS（iPad 含む）だけ言葉の入力を OS 標準の入力ダイアログ（window.prompt）に切り替え。iPhone 実機で、ダイアログ入力後に振って解放でき、取り消し画面が出ないことを確認（2026-09-24）
- 学び（スキル還流候補）: 消音スイッチ対策（audioSession = playback）とマイク入力は両立しない。マイクを使う機能と一緒に入れるなら、利用中だけ play-and-record へ切り替える。テキスト入力と「振る」操作を同じ画面に置くと iOS の Shake to Undo と衝突する

## Phase 11: 遊び方説明（ユーザーマニュアル）と日英対応（2026-09-24）

- 計画正本: `docs/help-manual-plan.md`（ユーザー選択: 1 枚に全部 / 基本 3 項目だけ小アニメ / 「?」は右下ボタン群の一番上 / 初回の爆発後に「?」を一度光らせる / 日英・画面上の文字すべて・トグルはタイトル画面と説明カード内）
- 実装:
  - `src/i18n.ts`: 日英の辞書（`satisfies Record<string, Record<Lang, string>>` で訳し漏れを型で検出）、`t()`、言語の検出（記憶 → navigator.languages）と保存、`data-i18n` / `data-i18n-attr` の一括差し替え、切り替え通知
  - `src/manual.ts`: ネイティブ `<dialog>` + `showModal()` で開閉（×・背景・Esc）、`?` キー、初回案内（localStorage に案内済みだけ記録）
  - 導入画面の "How to Play" と言語トグルは pointerdown の伝播を止め、押しても作品が始まらない
  - 溜め〜着弾の間は `body.is-charging` で右下のボタン群を薄くする（状態が変わったときだけ DOM を触る）
  - 基本 3 項目の小アニメはインライン SVG + CSS（`transform-box: view-box` で回転中心を固定）。reduced-motion では完成状態の静止画
  - 横長で低い画面は 2 列、高さ 700px / 420px 未満は段階的に縮小
- 検証（agent-browser・本番ビルドの vite preview）: 5 画面サイズ × 日英の 10 通りで説明カードがスクロール無しで収まる（scrollHeight = clientHeight）、"How to Play" を押しても導入画面が残り AudioContext 未生成、溜め中にボタン群 0.18、初回の爆発後に「?」が 1 回脈打ち案内済みを記録、`?` キー・×・Esc・背景で開閉、カード内の操作で作品が反応しない、トグルで全文字が切り替わり再読み込み後も保持、英語ブラウザ（--lang=en-US）で自動的に英語、エラー 0
- main へ早送りマージして本番デプロイ（版 0291a2d6）。本番で英語ブラウザの自動選択・How to Play で開始しない・390×844 で 1 枚に収まる・トグルで日本語へ切り替え・エラー 0 を確認
- ハマり（検証側）:
  - zsh は `set -- $var` で単語分割しない → 画面サイズが渡らず全ケース同じ寸法で「収まる」と誤判定しかけた。スクショの実寸を確認して発覚。**計測値が条件を変えても同一なら、条件が効いていない疑いを先に潰す**
  - agent-browser の `press "?"` でキーが押しっぱなしになり、閉じてもすぐ開き直す（keydown が延々と届く）。記号キーは合成イベントで送る

## Phase 12: 正式タイトル「Heartburst」（2026-09-24）

- 候補 6 案（Heartburst / Hush & Bloom / Burst Bloom / Let Go / ためて、はなつ / モヤモヤ・ボム）からユーザーが Heartburst を選択。Heart（心・心拍 ─ 心拍に合わせるクリティカル）+ burst（解放）で「胸の内が弾ける」
- 同名確認（Web 検索）: 同名のゲーム・アート作品は見当たらず。同名は米国の非営利向け CRM サービスと Roblox「Fisch」の効果名で、分野が異なる。商標データベース（USPTO / J-PlatPat）は未確認
- 反映: タイトル画面・ページタイトル・meta description・OGP（日英併記）・README・音響エンジンの見出し・コンソール表記。副題「溜めて、放つ。/ Hold. Let go.」
- タイトルロゴ（`docs/images/heartburst-logo.png`、README の先頭）: gpt-image-2 スキル（Codex 経由・バックエンドは未検証）で生成。1 回目の 16:9 キービジュアルは不採用（ユーザー: 「作るのはタイトルロゴ。文字だけを装飾、背景は透過、副題は不要」）。2 回目は**真っ黒な背景に発光ロゴだけ**を描かせ、手元で「明るさ = 不透明度」（alpha = max(R,G,B)、色は alpha で割り戻し）に変換して透過 PNG 化。生成モデルに直接透過を頼むより、光のにじみが半透明のまま残り、市松模様が描き込まれる事故もない。黒に戻したときの差は平均 1.3 / 最大 10（0〜255）。市松・作品背景・白の 3 背景に重ねた比較シートで 2 案を見比べてもらい B 案を採用
- タイトル画面の文字もロゴ画像に置き換え（`web/public/heartburst-logo.webp`、WebP 透過・約 177KB、`h1` + alt="Heartburst"、width/height 指定でレイアウトのずれ防止、幅 min(86vw, 640px, 140dvh) でスマホ横でも収まる）
- 右下のボタン: ユーザー指示で「?」を「声で溜める」と横並びに（`.word-ui-row`）
- タイトル画面の背景を半透明にして後ろの本物の粒子・星雲を見せ（CSS の擬似粒子は削除）、「タップしてスタート / クリックしてスタート」（`pointer: coarse` で出し分け・日英）を追加。進行の点は遊び始めてから表示
- main へ早送りマージして本番デプロイ（版 289143e8）。本番でロゴ（webp 200）・タイトル・OGP・開始の合図・クリックで開始して音声 running・エラー 0 を確認
- 旧名のまま残したもの（互換のため）: ネイティブ版のフォルダ名 `processing/CatharsisField/`（改名すると Processing スケッチとして開けない）、公開 URL と Worker 名 `catharsisfield`（リンク切れ防止）、localStorage のキー `catharsisfield.*`（利用者の記憶が消えるため）、過去の工程ログ・設計書

## Phase 13: 名前を heartburst に統一（2026-09-24）

- ユーザー指示: 作業用ブランチ 3 本の削除、URL を heartburst に（旧 URL の転送は不要・旧 Worker は削除）、プロジェクト名・フォルダ名その他を visual-art / CatharsisField から heartburst へ完全に統一
- リポジトリ内: Worker 名 `heartburst`・package 名 `heartburst-web`・OGP の URL・localStorage キー `heartburst.*`（起動時に旧キー `catharsisfield.*` から引き継いで旧キーは削除）・開発用ハンドル `__heartburstAudio` / `__heartburstDebug` / Strudel の `__heartburst`・音響エンジン `heartburst-engine.ts` / `HeartburstAudioEngine`・ネイティブ版 `processing/Heartburst/Heartburst.pde`（Processing はメイン .pde 名 = フォルダ名が必須）・`bin/start.sh` と `sc/main.scd` の起動完了文字列・ログ `/tmp/heartburst`・設計書と README の見出し。過去の工程ログは当時の記録として残す
- 検証: tsc・ビルド・Processing CLI でスケッチのコンパイル（Heartburst.class 生成）・start.sh の構文・旧キー → 新キーの引き継ぎ・新 URL で開始から音声 running と Strudel 起動まで・エラー 0
- 本番: 新 Worker `heartburst`（https://heartburst.nagai-shouten.workers.dev、版 78b9ee0f）を公開して確認した後、旧 Worker `catharsisfield` を削除（旧 URL は 404）
- 事故: 削除前に `yes n | wrangler delete` で確認プロンプトの有無だけを見るつもりが、wrangler は非対話環境で「はい」を既定値として通過し削除まで実行した。削除自体はユーザー承認済み・新 URL の確認後だったので実害なし。**破壊的な wrangler コマンドは `--dry-run` / `--help` で調べ、n をパイプで渡す試し方をしない**（memory: wrangler-noninteractive-auto-yes）
- プロジェクトフォルダ（`~/Projects/Game/visual-art` → `~/Projects/Game/heartburst`）と Claude Code の作業データ・設定・Vault のセッション索引は、Claude Code を終了してから移行スクリプトで移す（起動中に移すと書き込み中の履歴や設定が壊れる／上書きされるため）
- 別リポジトリ `~/Projects/agent-assets` のスキル interactive-art-builder が参照実装として `~/Projects/visual-art` を 5 か所で指している（元から古いパス）。そのリポジトリのセッションで直す

## 未解決・保留

- 音の体感チューニング（音量バランス・ドロップの重さ・Tidal 混合比）はフィードバック駆動で随時。パラメータは全て定数化済み（README「チューニング」参照）
