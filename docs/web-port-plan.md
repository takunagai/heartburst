# CatharsisField ウェブ版 ─ 移植・公開計画

公開ルート: **p5.js + Web Audio (+ Strudel) で移植 → Cloudflare Workers（静的アセット）で公開**。
ネイティブ版（SC + Processing + Tidal）はマスター版として維持し、ウェブ版は「誰でも触れる」配布版とする二本立て。

## 技術対応表

| ネイティブ版 | ウェブ版 | 移植方針 |
|---|---|---|
| Processing 粒子（P2D / GL point） | **p5.js WEBGL + カスタムシェーダ or point()** | 状態機械・粒子アルゴリズムはほぼ 1:1 移植。4000 粒子は WebGL で余裕 |
| SC \chargeDrone | Web Audio: saw 2 基デチューン + sub sine → BiquadFilter(LPF) + 心拍 LFO（GainNode 変調） | SynthDef のパラメータ写像（level→周波数/LPF/音量）をそのまま移す |
| SC \dropBoom | OscillatorNode(sine) + ピッチエンベロープ 60→28Hz + WaveShaper(tanh) | setValueCurveAtTime / exponentialRamp |
| SC \shockwave | ノイズ AudioBuffer + BiquadFilter(BPF) スイープ 8k→200Hz | 0.6 秒ワンショット |
| SC \shimmer / \popPluck（Karplus-Strong） | DelayNode + フィードバックループの簡易 Karplus-Strong、またはフィルタ付き短音プラック | ペンタトニック音列は定数共有 |
| SC master（FreeVerb2 + Limiter） | ConvolverNode（生成インパルス応答）+ DynamicsCompressor（リミッタ代用） | リバーブ IR はコードで合成（外部ファイル不要） |
| Tidal 4 レイヤー（heartbeat/groove/afterglow/ambient） | **Strudel**（@strudel/web） | cF 相当は Strudel の外部シグナル参照で charge/energy を注入 |
| OSC（3 プロセス連携） | **廃止** ─ 同一ページ内の関数呼び出し + 共有 state | レイテンシ問題も消える |
| /sc/amp（音→視覚） | AnalyserNode でマスター振幅を直接取得 | 30Hz スロットル不要、毎フレーム取得可 |

## プロジェクト構成

```
web/
├── index.html          # クリックゲート（「触れて始める」）+ canvas
├── src/
│   ├── main.ts         # 起動・状態機械（ネイティブ版と同じ遷移）
│   ├── visuals.ts      # p5.js 粒子・衝撃波・フラッシュ・シェイク
│   ├── audio/
│   │   ├── engine.ts   # AudioContext・マスター（リバーブ+コンプ）・振幅取得
│   │   ├── charge.ts   # ドローン（level 追従）
│   │   ├── release.ts  # ドロップ・衝撃波・シャワー・ポップ
│   │   └── pattern.ts  # Strudel 層（4 レイヤー + charge/energy 注入）
│   └── tuning.ts       # チューニング定数の一元管理（ネイティブ版の定数と対応表コメント）
├── package.json        # Vite + TypeScript + p5 + @strudel/web
└── wrangler.jsonc      # Cloudflare Workers（assets 配信）
```

- ビルド: **Vite + TypeScript**（型安全 > DX > パフォーマンスの選定軸に沿う）
- p5.js・Strudel は npm 依存でバンドル（CDN 非依存 ─ オフラインでも動く単一配布物）
- Strudel のサンプル音源: 同梱の小さな自作サンプル or シンセのみ構成にして外部 CDN 依存を避ける（初期ロード軽量化）

## 体験設計（ウェブ固有）

1. **クリックゲート必須**: ブラウザの autoplay policy により初回ユーザー操作まで音が出せない。「画面に触れて、溜めて、解放する」の導入画面を作り、初回タップで AudioContext.resume() → そのまま 1 回目の溜めに繋げる（制約を演出に変換）
2. **タッチ対応**: touchstart/touchend をマウスと同一パスに写像 ─ スマホで指を押し当てて離す体験は本作と最も相性が良い
3. **可変粒子数**: デバイス性能で 1500〜4000 を自動調整（初回 2 秒の実測 fps でスケール）
4. **OGP / シェア**: 爆発瞬間のキャプチャを OGP 画像に。タイトル・説明・URL 設定

## フェーズ計画

| Phase | 内容 | 担当 | DoD |
|---|---|---|---|
| 1 | Vite+TS scaffold、粒子システム移植（無音）、状態機械 | サブエージェント委譲可 | ブラウザで溜め→解放の視覚が 60fps で動く |
| 2 | Web Audio 音響エンジン（charge/drop/shock/shimmer/pop + master） | **Fable 主導**（音響設計の質が核） | ネイティブ版と聴き比べて同等の気持ちよさ |
| 3 | Strudel パターン層 + charge/energy 注入 | **Fable 主導**（Tidal/Strudel は Fable 担当の方針） | 心拍・グルーヴがネイティブ版同様に追従 |
| 4 | タッチ対応・クリックゲート・粒子数自動調整・磨き | サブエージェント委譲可 | iPhone Safari で体験成立 |
| 5 | wrangler deploy・独自 URL・OGP・ナガイ商店.com 掲載 | メイン + deploy スキル | 公開 URL で誰でも遊べる |

- Phase 1-2 は並行可能（視覚と音は state インターフェース契約で分離 ─ ネイティブ版の architecture.md 方式を踏襲）
- 各 Phase 完了時に工程ログ（docs/process-log.md）へ追記（スキル化素材の継続蓄積）

## ライセンス方針（2026-07-13 確定）

- Strudel は **AGPLv3**（公式 FAQ: 組み込む側もソース公開必須、SaaS 条項あり）
- **決定: web/ を AGPLv3 でソース公開して Strudel 続行**（ユーザー承認済み）。アート作品のため公開に実害なし、制作記事戦略とも整合
- 対応: web/LICENSE に AGPLv3、公開リポジトリ化は Phase 5 で

## Strudel 裏取り結果（2026-07-13・実装の前提）

- 外部値注入: `signal(() => value)` ─ クエリごとにコールバック再実行、再評価不要（mouseX と同実装。core/signal.mjs で確認）
- 音源: 内蔵シンセ（sawtooth/square/sine/triangle/noise 系/FM）は CDN 不要。**サンプル（bd 等）は既定で外部 CDN → 使わず内蔵シンセのみで 4 レイヤーを再設計**
- 文法差: `#` → メソッドチェーン、cF → signal()。fast/degradeBy/segment/euclid/arp/gain/lpf/room はほぼ同名
- AudioContext 共有: `setAudioContext(ctx)` で注入可（出力ノード割り込みの公開 API は未確認 → パターン層は ctx.destination 直結を許容）

## リスクと手当て
- **iOS Safari の AudioContext 制約**（サンプルレート・同時ノード数）: Phase 2 の早期に実機確認
- **Karplus-Strong の忠実再現が重い場合**: プラック音はプリレンダした AudioBuffer 再生に切替（音色固定化とのトレード）

## 公開先

- Cloudflare Workers（静的アセット、無料枠で十分）。wrangler は deploy-astro-cloudflare スキルではなく素の `wrangler deploy`（フレームワーク非依存の静的配信のため）
- ドメイン: workers.dev サブドメイン → 好みで nagai-shouten.com のサブドメイン割当
