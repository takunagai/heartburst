// ============================================================
// tuning.ts ─ チューニング定数の一元管理
//
// processing/CatharsisField/CatharsisField.pde 冒頭の定数を移植したもの。
// 各定数のコメントは .pde 側の定数名を示す。値は変更していない
// （状態機械の物理は 60fps 固定を前提にチューニングされているため、
// フレームレート非依存化はせず main.ts 側で frameRate(60) を明示する）。
// ============================================================

export const PARTICLE_COUNT = 4000; // PARTICLE_COUNT
export const POP_SPARK_COUNT = 20; // POP_SPARK_COUNT
export const MAX_SHOCKWAVES = 6; // MAX_SHOCKWAVES

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
// 粒子数の自動調整（Phase 4）
//
// 起動後 FPS_SAMPLE_FRAMES フレームの実測 deltaTime から fps を求め、
// しきい値未満なら段階的に間引く（増加はしない・配列を切り詰めるだけ）。
// ただし「フレーム間隔が均一なまま低fps」は macOS 省エネモード等による
// rAF 自体の周波数制限であって重さではないため、間引かない
// （変動係数 = 標準偏差 / 平均 で判定。低ければ「制限」、高ければ「重い」）。
// ------------------------------------------------------------
export const PARTICLE_COUNT_LEVELS = [PARTICLE_COUNT, 2500, 1500] as const; // 先頭は PARTICLE_COUNT と同値
export const FPS_SAMPLE_FRAMES = 120; // 判定に使うフレーム数
export const FPS_REDUCE_THRESHOLD = 50; // 実測 fps がこれを下回ったら削減候補
export const FPS_JITTER_CV_THRESHOLD = 0.15; // 変動係数がこれを超えたら「重い」と判定（下回れば rAF 制限とみなし削減しない）
export const FRAME_TIME_OUTLIER_MS = 300; // タブ非アクティブ復帰等の外れ値。混入した計測ウィンドウは破棄する
