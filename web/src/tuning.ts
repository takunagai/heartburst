// ============================================================
// tuning.ts ─ チューニング定数の一元管理
//
// processing/Heartburst/Heartburst.pde 冒頭の定数を移植したもの。
// 各定数のコメントは .pde 側の定数名を示す。値は変更していない
// （状態機械の物理は 60fps 固定を前提にチューニングされているため、
// フレームレート非依存化はせず main.ts 側で frameRate(60) を明示する）。
// ============================================================

export const PARTICLE_COUNT = 8000; // 粒子は画面より大きい真円に住むため、画面内の密度を保つよう旧 4000 から倍増（画面外は描画を省く）
export const POP_SPARK_COUNT = 20; // POP_SPARK_COUNT
export const MAX_SHOCKWAVES = 16; // 解放 1 回で 3〜6 本（先行波・本波・残響波 + 特殊）+ 段階チャージの輪

export const BG_COLOR_HEX = "#050508"; // BG_COLOR
export const COLOR_CYAN_HEX = "#00E5FF"; // COLOR_CYAN
export const COLOR_MAGENTA_HEX = "#FF2BD6"; // COLOR_MAGENTA

export const CHARGE_DURATION_MS = 3000; // CHARGE_DURATION_MS ─ level が 0→1 に到達するまでの保持時間（イージング前）
export const DECAY_DURATION_MS = 3000; // DECAY_DURATION_MS ─ energy が 1→0 に減衰するまでの時間
export const POP_THRESHOLD_MS = 300; // POP_THRESHOLD_MS ─ これ未満の保持は pop 扱い

// OSC_SEND_INTERVAL_MS（33ms ≒ 30Hz）はネイティブ版の OSC 送出スロットル。
// ウェブ版は同一ページ内の直接関数呼び出しのため帯域制約が無く、
// main.ts は audio.chargeLevel() / audio.setEnergy() を毎フレーム呼ぶ
// （AudioEngine インターフェース側もそれを想定した契約）。
// Phase 2 の内部処理（LFO 更新レート等）の目安値として値のみ残す。
export const AUDIO_UPDATE_INTERVAL_MS = 33; // OSC_SEND_INTERVAL_MS

// 粒子の運動パラメータ
export const IDLE_SPEED = 0.6; // IDLE_SPEED
export const FLOW_SCALE = 0.0025; // FLOW_SCALE
export const FLOW_TIME_SCALE = 0.0015; // FLOW_TIME_SCALE
export const MIN_ORBIT_RADIUS_MAX = 150; // MIN_ORBIT_RADIUS_MAX ─ level=0 のときの最小軌道半径
export const MIN_ORBIT_RADIUS_MIN = 14; // MIN_ORBIT_RADIUS_MIN ─ level=1 のときの最小軌道半径
export const PULL_STRENGTH_MIN = 0.15; // PULL_STRENGTH_MIN
export const PULL_STRENGTH_MAX = 0.95; // PULL_STRENGTH_MAX
export const CHARGE_DAMPING = 0.9; // CHARGE_DAMPING
export const JITTER_AMOUNT = 1.3; // JITTER_AMOUNT
export const FRICTION = 0.94; // FRICTION

export const DRAG_BOOST_PER_PIXEL = 0.0006; // DRAG_BOOST_PER_PIXEL
export const DRAG_BOOST_MAX = 0.35; // DRAG_BOOST_MAX

export const IMPULSE_SPEED_MIN = 6; // IMPULSE_SPEED_MIN
export const IMPULSE_SPEED_MAX = 34; // IMPULSE_SPEED_MAX

export const POP_SPARK_SPEED_MIN = 4; // POP_SPARK_SPEED_MIN
export const POP_SPARK_SPEED_MAX = 9; // POP_SPARK_SPEED_MAX

export const SHOCKWAVE_RADIUS_MIN = 220; // SHOCKWAVE_RADIUS_MIN
export const SHOCKWAVE_RADIUS_MAX = 1300; // SHOCKWAVE_RADIUS_MAX

export const SHAKE_DECAY = 0.85; // SHAKE_DECAY
export const FLASH_DECAY = 0.12; // FLASH_DECAY ─ 1〜2 フレームでほぼ消える急減衰
export const DECAY_SPEED_REF = 6.0; // DECAY_SPEED_REF ─ decay 中、この速度で粒子の輝度・alpha が飽和する

export const VIGNETTE_INNER = 0.35; // VIGNETTE_INNER ─ このデフォルト距離比から暗さが始まる
export const VIGNETTE_MAX_ALPHA = 200; // VIGNETTE_MAX_ALPHA ─ level=1 のときのヴィネット最大不透明度（RGB colorMode の 0-255 レンジで使用）

// ------------------------------------------------------------
// 解放シーケンス（Phase 9-1 ─ ウェブ版独自。ネイティブ版には無い）
//
//   pointerup ─→ inhale（吸い込み + 無音。音響側が次の 16 分に量子化した着弾時刻まで）
//             ─→ impact（ヒットストップ ─ 物理停止・フラッシュ保持）
//             ─→ decay（スローモーションから等速へ戻る）
// ------------------------------------------------------------
export const INHALE_PULL_MUL = 2.2; // inhale 中の引力倍率（PULL_STRENGTH_MAX 基準）
export const INHALE_MIN_ORBIT = 5; // inhale 中の最小軌道半径
export const HITSTOP_MS_MIN = 30; // level=0 のヒットストップ長
export const HITSTOP_MS_MAX = 95; // level=1 のヒットストップ長
export const SLOWMO_TIME_SCALE = 0.3; // ヒットストップ明けの時間倍率（level=1 のとき。level=0 は 1.0）
export const SLOWMO_RECOVER_MS = 1100; // 等速へ戻るまでの時間
export const FLASH_ALPHA_MIN = 35; // level=0 のフラッシュ不透明度（alpha レンジ 100）
export const FLASH_ALPHA_MAX = 70; // level=1 のフラッシュ不透明度

// カメラ（ズームは解放地点を中心に掛ける）
export const ZOOM_INHALE = 0.07; // inhale 中のズームイン量（level=1 のとき 1.07 倍）
export const ZOOM_IMPACT_KICK = -0.09; // 着弾時のズームアウト初速（パンチ）
export const ZOOM_SPRING = 0.14; // ばね定数
export const ZOOM_DAMPING = 0.72; // 減衰

// 速度ストリーク（粒子を速度方向の線で描く）
export const STREAK_MIN_SPEED = 1.6; // これ未満は点として描く
export const STREAK_LENGTH_PER_SPEED = 1.5; // 線の長さ = 速度 × この値
export const STREAK_MAX_LENGTH = 70;

// 粒子が住む範囲: 画面中心の真円（矩形だと溜めで画面の四辺がそのまま縮んで見えるため）
export const DOMAIN_RADIUS_SCALE = 1.4; // 半径 = 画面の対角線の半分 × この値
export const DOMAIN_RADIAL_EXPONENT = 0.7; // 配置の半径 = R × 乱数^この値（0.5 で一様、大きいほど中心が濃い）
export const DOMAIN_CENTER_PULL = 0.15; // idle 中、円の縁でこの速さ（px/frame）だけ中心へ寄せる（中心の濃さを保つ）
export const DOMAIN_ESCAPE_MARGIN = 40; // 爆発後、円の外へこれ以上出た粒子を再流入の対象にする
export const EDGE_RESPAWN_SPEED = 1.2; // 円の外でこの速度未満になったら円周から再流入させる
export const OFFSCREEN_CULL_MARGIN = 80; // 画面外のこの余白より外の粒子は描画しない（ストリークの最大長 + α）

// 衝撃波の歪み（通過した粒子を外へ押す）
export const SHOCKWAVE_PUSH_BAND = 60; // 波面からこの距離以内の粒子を押す
export const SHOCKWAVE_PUSH_FORCE = 3.2; // level=1 の押し出し量
export const SHOCKWAVE_ECHO_DELAY_FRAMES = 9; // 残響波の遅延

// 色温度（溜めで白熱、爆発で全色相へ散って戻る）
export const CHARGE_DESATURATE = 0.85; // level=1 で彩度をこの割合だけ落とす（白熱）
export const BURST_HUE_SPREAD = 360; // 爆発直後の色相の散らばり幅

// グロー（縮小キャンバスをぼかして screen 合成で重ねる）
export const GLOW_DOWNSCALE = 6; // 本体の 1/6 解像度
export const GLOW_BLUR_PX = 2.5; // 縮小キャンバス上のぼかし半径（ctx.filter 非対応環境では縮小・拡大の補間だけで代替）
export const GLOW_OPACITY_IDLE = 0.35;
export const GLOW_OPACITY_PEAK = 0.95;

// ------------------------------------------------------------
// 溜めのドラマとゲーム性（Phase 9-2）
// ------------------------------------------------------------
export const CHARGE_TIERS = [0.33, 0.66, 1.0] as const; // 段階チャージの閾値
export const TIER_SWIRL = [0.12, 0.3, 0.55, 0.85] as const; // 段階ごとの渦の強さ（接線方向の力 / 引力比）
export const CHARGE_RING_RADIUS = 46; // 溜めの進行を示す円弧の半径

export const OVERCHARGE_MS = 2600; // 満充填からこの時間保持し続けると暴発
export const OVERCHARGE_POWER_BONUS = 0.35; // オーバーチャージ満了時の威力加算（power = 1 + bonus × o）
export const OVERCHARGE_SHAKE = 9; // オーバーチャージ満了時の常時揺れ
export const OVERCHARGE_HUE = 8; // オーバーチャージで寄っていく色相（赤）

export const CRITICAL_MIN_LEVEL = 0.5; // これ以上溜めた解放だけクリティカル判定する
export const CRITICAL_WINDOW = 0.12; // 心拍の位相がこの範囲（拍の前後）で離せばクリティカル（溜め中は金の輪で合図）
export const CRITICAL_POWER_BONUS = 0.15;
export const CRITICAL_HUE = 45; // 金

export const SLINGSHOT_MIN_SPEED = 0.9; // 離す直前の弾き速度（px/ms）がこれ以上で指向性爆発
export const SLINGSHOT_MAX_SPEED = 4.0; // この速度で指向性が最大
export const SLINGSHOT_SAMPLE_MS = 70; // 弾き速度を測る直前区間

export const HOVER_RADIUS = 130; // idle 中、カーソル周りの粒子が避ける半径
export const HOVER_FORCE = 0.35;
export const HOVER_BRIGHTEN = 45; // カーソル近傍の粒子の輝度加算

export const SHAKE_RELEASE_ACCEL = 17; // スマホを振って解放する加速度（m/s²、重力除く）

// ------------------------------------------------------------
// 声で溜める（E3・任意機能。マイクの音量だけを使い、録音・送信はしない）
// ------------------------------------------------------------
export const VOICE_FLOOR_DB = -50; // これ以下の音量は 0（環境音）
export const VOICE_CEIL_DB = -12; // これ以上の音量は 1（叫び）
export const VOICE_START_LEVEL = 0.35; // この声量が VOICE_START_HOLD_MS 続いたら溜め開始
export const VOICE_START_HOLD_MS = 120; // 咳・物音で誤発動しないための持続時間
export const VOICE_STOP_LEVEL = 0.15; // これ未満が VOICE_RELEASE_SILENCE_MS 続いたら解放
export const VOICE_RELEASE_SILENCE_MS = 280;
export const VOICE_CHARGE_RATE = 0.012; // 1 フレームあたりの溜め（声量 1 で約 1.4 秒で満充填）
export const VOICE_BOOST_PER_FRAME = 0.006; // 長押し中の声による溜めの加速
export const VOICE_REARM_MS = 1500; // 爆発後、自分の爆発音で声の溜めが誤発動しないよう待つ時間

// ------------------------------------------------------------
// 粒子数の自動調整（Phase 4）
//
// 起動後 FPS_SAMPLE_FRAMES フレームの実測 deltaTime から fps を求め、
// しきい値未満なら段階的に間引く（増加はしない・配列を切り詰めるだけ）。
// ただし「フレーム間隔が均一なまま低fps」は macOS 省エネモード等による
// rAF 自体の周波数制限であって重さではないため、間引かない
// （変動係数 = 標準偏差 / 平均 で判定。低ければ「制限」、高ければ「重い」）。
// ------------------------------------------------------------
export const PARTICLE_COUNT_LEVELS = [PARTICLE_COUNT, 5000, 3000] as const; // 先頭は PARTICLE_COUNT と同値
export const FPS_SAMPLE_FRAMES = 120; // 判定に使うフレーム数
export const FPS_REDUCE_THRESHOLD = 50; // 実測 fps がこれを下回ったら削減候補
export const FPS_JITTER_CV_THRESHOLD = 0.15; // 変動係数がこれを超えたら「重い」と判定（下回れば rAF 制限とみなし削減しない）
export const FRAME_TIME_OUTLIER_MS = 300; // タブ非アクティブ復帰等の外れ値。混入した計測ウィンドウは破棄する
