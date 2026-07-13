// ============================================================
// CatharsisField ─ メインスケッチ
//
// 「溜めて解放（Charge & Release）」のインタラクティブ・ビジュアル。
// 状態機械の正本はこのファイル（入力の発生源のため）。
// 詳細仕様は docs/architecture.md を参照。
//
//   idle ──mousePressed──→ charging ──mouseReleased──→ releasing ──(1frame)──→ decay ──(約3秒)──→ idle
//                             │ level = f(保持時間, ドラッグ量) ∈ [0,1]
//                             └─ 30Hz で /charge/level, /ctrl "charge" 送信
//
// 保持 < 300ms の短クリックは「小破裂（pop）」の軽量パスへ分岐する。
// ============================================================

import oscP5.*;
import netP5.*;

// ---- チューニング定数 ----

final int PARTICLE_COUNT = 4000;      // 起動時の粒子数（ここを調整すれば負荷を変えられる）
final int POP_SPARK_COUNT = 20;       // 小破裂で飛ばす粒子数
final int MAX_SHOCKWAVES = 6;         // 衝撃波リングの同時最大数（配列使い回し）

final color BG_COLOR = #050508;
final color COLOR_CYAN = #00E5FF;
final color COLOR_MAGENTA = #FF2BD6;

final float CHARGE_DURATION_MS = 3000;  // level が 0→1 に到達するまでの保持時間（イージング前）
final float DECAY_DURATION_MS = 3000;   // energy が 1→0 に減衰するまでの時間
final float POP_THRESHOLD_MS = 300;     // これ未満の保持は pop 扱い

final int OSC_SEND_INTERVAL_MS = 33;    // 約 30Hz スロットル

final String SC_HOST = "127.0.0.1";
final int SC_PORT = 57120;
final String TIDAL_HOST = "127.0.0.1";
final int TIDAL_PORT = 6010;
final int RECEIVE_PORT = 12000;

// 粒子の運動パラメータ
final float IDLE_SPEED = 0.6;
final float FLOW_SCALE = 0.0025;
final float FLOW_TIME_SCALE = 0.0015;
final float MIN_ORBIT_RADIUS_MAX = 150;  // level=0 のときの最小軌道半径
final float MIN_ORBIT_RADIUS_MIN = 14;   // level=1 のときの最小軌道半径
final float PULL_STRENGTH_MIN = 0.15;
final float PULL_STRENGTH_MAX = 0.95;
final float CHARGE_DAMPING = 0.9;
final float JITTER_AMOUNT = 1.3;
final float FRICTION = 0.94;

final float DRAG_BOOST_PER_PIXEL = 0.0006;
final float DRAG_BOOST_MAX = 0.35;

final float IMPULSE_SPEED_MIN = 6;
final float IMPULSE_SPEED_MAX = 34;

final float POP_SPARK_SPEED_MIN = 4;
final float POP_SPARK_SPEED_MAX = 9;

final float SHOCKWAVE_RADIUS_MIN = 220;
final float SHOCKWAVE_RADIUS_MAX = 1300;

final float SHAKE_DECAY = 0.85;
final float FLASH_DECAY = 0.12; // 1〜2 フレームでほぼ消える急減衰
final float DECAY_SPEED_REF = 6.0; // decay 中、この速度で粒子の輝度・alpha が飽和する

final float VIGNETTE_INNER = 0.35;   // このデフォルト距離比から暗さが始まる
final float VIGNETTE_MAX_ALPHA = 200; // level=1 のときのヴィネット最大不透明度

// ---- 状態機械 ----

final int STATE_IDLE = 0;
final int STATE_CHARGING = 1;
final int STATE_RELEASING = 2;
final int STATE_DECAY = 3;

int state = STATE_IDLE;

long chargeStartMillis = 0;
float level = 0;
float dragBoost = 0;

float energy = 0;
long decayStartMillis = 0;

long lastOscSendMillis = 0;

// 演出用の状態
float flashAlpha = 0;
float shakeIntensity = 0;
float shakeX = 0, shakeY = 0;

// 粒子・衝撃波（配列使い回し。毎フレームの生成は行わない）
Particle[] particles;
Shockwave[] shockwaves;
int popSparkCursor = 0;

PVector attractorPos = new PVector();

// フレーム不変値のキャッシュ（粒子ループ 4000 回で再計算しない）
float bgHue, bgSat, bgBri;                    // 背景色の HSB 分解（起動時 1 回）
float frameMinOrbit, framePullStrength;       // charging 中の引力パラメータ（フレームごと 1 回）

PImage vignetteImg; // charging 中に画面端を暗くする放射グラデーション（起動時 1 回だけ生成）

OscBridge osc;

// ---- デバッグ HUD ----
boolean showHud = false;

void settings() {
  fullScreen(P2D);
  pixelDensity(1); // retina の 4 倍ピクセルを回避（発光粒子は等倍でも見劣りしない）
}

void setup() {
  colorMode(HSB, 360, 100, 100, 100);
  frameRate(60);
  background(BG_COLOR);
  noStroke();

  bgHue = hue(BG_COLOR);
  bgSat = saturation(BG_COLOR);
  bgBri = brightness(BG_COLOR);

  osc = new OscBridge(this, RECEIVE_PORT, SC_HOST, SC_PORT, TIDAL_HOST, TIDAL_PORT);

  particles = new Particle[PARTICLE_COUNT];
  for (int i = 0; i < PARTICLE_COUNT; i++) {
    particles[i] = new Particle();
  }

  shockwaves = new Shockwave[MAX_SHOCKWAVES];
  for (int i = 0; i < MAX_SHOCKWAVES; i++) {
    shockwaves[i] = new Shockwave();
  }

  buildVignette();
}

// 画面端を暗くする放射グラデーションを起動時に 1 回だけピクセル単位で生成し、
// draw() 内では image() で重ねるだけにして毎フレームコストを避ける
void buildVignette() {
  vignetteImg = createImage(width, height, ARGB);
  vignetteImg.loadPixels();
  float cx = width / 2.0;
  float cy = height / 2.0;
  float maxDist = dist(0, 0, cx, cy);
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      float d = dist(x, y, cx, cy) / maxDist;
      float a = constrain(map(d, VIGNETTE_INNER, 1.0, 0, 255), 0, 255);
      vignetteImg.pixels[y * width + x] = color(0, 0, 0, a);
    }
  }
  vignetteImg.updatePixels();
}

void draw() {
  osc.updateSmoothing();
  updateState();
  updateShake();

  pushMatrix();
  translate(shakeX, shakeY);

  // 背景をごく薄く重ねて軌跡（トレイル）を残す。ADD 合成前に BLEND で行う
  // alpha を上げるほどトレイルが短くなり、加算合成の白浮きも早く沈む
  blendMode(BLEND);
  noStroke(); // 粒子描画の stroke 状態を持ち越さない
  fill(bgHue, bgSat, bgBri, 55);
  rect(-40, -40, width + 80, height + 80);

  blendMode(ADD);

  attractorPos.set(mouseX, mouseY);

  // 粒子ループの不変値はフレームごとに 1 回だけ算出
  if (state == STATE_CHARGING) {
    frameMinOrbit = lerp(MIN_ORBIT_RADIUS_MAX, MIN_ORBIT_RADIUS_MIN, level);
    framePullStrength = lerp(PULL_STRENGTH_MIN, PULL_STRENGTH_MAX, level);
  }

  for (int i = 0; i < PARTICLE_COUNT; i++) {
    Particle p = particles[i];
    p.update(state, level, attractorPos);
    p.display(state, level, osc.getAmp());
  }

  for (int i = 0; i < MAX_SHOCKWAVES; i++) {
    shockwaves[i].update();
    shockwaves[i].display();
  }

  popMatrix();

  blendMode(BLEND);

  // charging 中は画面端をヴィネットで暗くする（level に応じて濃くなる）
  if (state == STATE_CHARGING && level > 0.001) {
    pushStyle();
    colorMode(RGB, 255);
    tint(255, level * VIGNETTE_MAX_ALPHA);
    image(vignetteImg, 0, 0);
    noTint();
    popStyle();
  }

  // フラッシュは画面全体に BLEND で重ねる（ADD だと白飽和が消えにくい）
  if (flashAlpha > 0.5) {
    noStroke();
    fill(0, 0, 100, flashAlpha);
    rect(0, 0, width, height);
  }
  // 減衰は描画後に行う（release 直後の初回フレームを満輝度で見せるため。描画順に依存する点は意図的）
  flashAlpha *= FLASH_DECAY;
  if (flashAlpha < 0.5) flashAlpha = 0;

  if (showHud) drawHud();

  // パフォーマンス計測（チューニング期間のみ。2 秒ごとに fps をログへ）
  if (frameCount % 120 == 0) {
    println("[perf] fps=" + nf(frameRate, 0, 1) + " state=" + stateName(state));
  }
}

// ---- 状態機械の更新 ----

void updateState() {
  if (state == STATE_CHARGING) {
    updateCharging();
  } else if (state == STATE_RELEASING) {
    // release 演出は trigger 時に単発発火済み。1 フレームだけ経由して decay へ
    state = STATE_DECAY;
  } else if (state == STATE_DECAY) {
    updateDecay();
  }
}

void updateCharging() {
  float heldMs = millis() - chargeStartMillis;
  float t = constrain(heldMs / CHARGE_DURATION_MS, 0, 1);
  float eased = easeOutQuad(t);
  level = constrain(eased + dragBoost, 0, 1);

  if (oscTick()) {
    osc.sendChargeLevel(level);
    osc.sendCtrlCharge(level);
  }
}

void updateDecay() {
  float elapsed = millis() - decayStartMillis;
  energy = constrain(1.0 - elapsed / DECAY_DURATION_MS, 0, 1);

  if (oscTick()) {
    osc.sendCtrlEnergy(energy);
  }

  if (energy <= 0) {
    state = STATE_IDLE;
    level = 0;
  }
}

// 30Hz スロットルの単一ゲート。true を返したフレームだけ OSC 連続ストリームを送出する
boolean oscTick() {
  if (millis() - lastOscSendMillis < OSC_SEND_INTERVAL_MS) return false;
  lastOscSendMillis = millis();
  return true;
}

float easeOutQuad(float t) {
  return 1 - (1 - t) * (1 - t);
}

// ---- 入力ハンドラ ----

float normX() { return mouseX / (float) width; }
float normY() { return mouseY / (float) height; }

void mousePressed() {
  if (state == STATE_IDLE || state == STATE_DECAY) {
    state = STATE_CHARGING;
    chargeStartMillis = millis();
    level = 0;
    dragBoost = 0;
    lastOscSendMillis = 0; // 直後の送信を許可

    osc.sendChargeStart(normX(), normY());
  }
}

void mouseDragged() {
  if (state != STATE_CHARGING) return;
  float d = dist(mouseX, mouseY, pmouseX, pmouseY);
  dragBoost = min(dragBoost + d * DRAG_BOOST_PER_PIXEL, DRAG_BOOST_MAX);
}

void mouseReleased() {
  if (state != STATE_CHARGING) return;

  long heldMs = millis() - chargeStartMillis;
  float nx = normX();
  float ny = normY();

  if (heldMs < POP_THRESHOLD_MS) {
    triggerPop(mouseX, mouseY, nx, ny);
    state = STATE_IDLE;
  } else {
    triggerRelease(mouseX, mouseY, level, nx, ny);
    state = STATE_RELEASING;
  }
}

void keyPressed() {
  if (key == 'd' || key == 'D') {
    showHud = !showHud;
  }
}

// ---- 演出トリガー ----

void triggerRelease(float px, float py, float releaseLevel, float nx, float ny) {
  energy = 1.0;
  decayStartMillis = millis();
  lastOscSendMillis = 0;

  for (int i = 0; i < PARTICLE_COUNT; i++) {
    particles[i].applyImpulse(px, py, releaseLevel);
  }

  spawnShockwave(px, py, releaseLevel);

  flashAlpha = 100; // colorMode の alpha レンジは 100
  shakeIntensity = lerp(4, 40, releaseLevel);

  osc.sendRelease(releaseLevel, nx, ny);
}

void triggerPop(float px, float py, float nx, float ny) {
  for (int i = 0; i < POP_SPARK_COUNT; i++) {
    int idx = (popSparkCursor + i) % PARTICLE_COUNT;
    particles[idx].popSpark(px, py);
  }
  popSparkCursor = (popSparkCursor + POP_SPARK_COUNT) % PARTICLE_COUNT;

  osc.sendPop(nx, ny);
}

void spawnShockwave(float px, float py, float waveLevel) {
  // 非活性の個体を探して再利用。全部活性中なら先頭を上書き
  for (int i = 0; i < MAX_SHOCKWAVES; i++) {
    if (!shockwaves[i].active) {
      shockwaves[i].start(px, py, waveLevel);
      return;
    }
  }
  shockwaves[0].start(px, py, waveLevel);
}

// ---- シェイク ----

void updateShake() {
  if (shakeIntensity > 0.05) {
    shakeX = random(-shakeIntensity, shakeIntensity);
    shakeY = random(-shakeIntensity, shakeIntensity);
    shakeIntensity *= SHAKE_DECAY;
  } else {
    shakeX = 0;
    shakeY = 0;
    shakeIntensity = 0;
  }
}

// ---- OSC 受信（oscP5 はメインスケッチ = PApplet を対象にリフレクションで
// oscEvent を呼ぶ。データの保持・平滑化は OscBridge に委譲する）----

void oscEvent(OscMessage msg) {
  osc.handleIncoming(msg);
}

// スケッチ終了時（ESC・ウィンドウクローズ）に UDP ポートを即時解放する
void dispose() {
  if (osc != null) osc.close();
}

// ---- デバッグ HUD ----

void drawHud() {
  fill(0, 0, 100, 100);
  textSize(13);
  text("fps: " + nf(frameRate, 0, 1), 12, 20);
  text("state: " + stateName(state), 12, 38);
  text("level: " + nf(level, 1, 2) + "  energy: " + nf(energy, 1, 2), 12, 56);
}

String stateName(int s) {
  if (s == STATE_IDLE) return "idle";
  if (s == STATE_CHARGING) return "charging";
  if (s == STATE_RELEASING) return "releasing";
  return "decay";
}
