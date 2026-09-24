// ============================================================
// Particle ─ 粒子 1 個の状態と振る舞い
//
// idle    : パーリンノイズのフローフィールドで漂う（低輝度）
// charging: カーソルへ引力（level で強化）。最小軌道半径を下回ると
//           反発ジッターに切り替え、点に収束しすぎるのを防ぐ
// decay   : 摩擦で減速しつつフローフィールドへ回帰
// ============================================================

class Particle {

  float x, y;
  float vx, vy;
  float baseSize;
  float noiseOffset;  // フローフィールドの個体差用オフセット

  // 個体色は不変なので HSB 分解までコンストラクタで済ませる
  // （display() で毎フレーム 4000 回の色空間変換をしない）
  float hueVal, satVal, briBase;

  Particle() {
    respawnRandom();
    baseSize = random(1.4, 3.0);
    noiseOffset = random(1000.0);

    color c = lerpColor(COLOR_CYAN, COLOR_MAGENTA, random(1.0)); // シアン〜マゼンタの個体差
    hueVal = hue(c);
    satVal = saturation(c);
    briBase = brightness(c);
  }

  void respawnRandom() {
    x = random(width);
    y = random(height);
    vx = 0;
    vy = 0;
  }

  // pop（小破裂）用: 既存粒子を指定座標へワープさせ、放射状の初速を与える
  void popSpark(float px, float py) {
    x = px;
    y = py;
    float ang = random(TWO_PI);
    float spd = random(POP_SPARK_SPEED_MIN, POP_SPARK_SPEED_MAX);
    vx = cos(ang) * spd;
    vy = sin(ang) * spd;
  }

  // release（解放）用: 爆心からの放射インパルスを与える
  void applyImpulse(float cx, float cy, float releaseLevel) {
    float dx = x - cx;
    float dy = y - cy;
    float d = mag(dx, dy) + 0.001;
    float speed = lerp(IMPULSE_SPEED_MIN, IMPULSE_SPEED_MAX, releaseLevel) * random(0.7, 1.3);
    vx += (dx / d) * speed;
    vy += (dy / d) * speed;
  }

  void update(int pState, float chargeLevel, PVector attractor) {
    switch (pState) {
      case STATE_IDLE:
        flowDrift(1.0);
        break;
      case STATE_CHARGING:
        chargingPull(attractor, chargeLevel);
        break;
      case STATE_RELEASING:
        // インパルス直後の 1 フレームのみ通過。速度は applyImpulse 済みなので摩擦のみ
        vx *= FRICTION;
        vy *= FRICTION;
        break;
      case STATE_DECAY:
        vx *= FRICTION;
        vy *= FRICTION;
        flowDrift(0.35); // 摩擦をかけつつ緩やかにフローへ回帰
        break;
    }

    x += vx;
    y += vy;
    wrapEdges();
  }

  private float flowAngle() {
    float n = noise(x * FLOW_SCALE, y * FLOW_SCALE, frameCount * FLOW_TIME_SCALE + noiseOffset);
    return n * TWO_PI * 4.0;
  }

  private void flowDrift(float blend) {
    float angle = flowAngle();
    float targetVx = cos(angle) * IDLE_SPEED;
    float targetVy = sin(angle) * IDLE_SPEED;
    vx = lerp(vx, targetVx, 0.06 * blend);
    vy = lerp(vy, targetVy, 0.06 * blend);
  }

  private void chargingPull(PVector attractor, float chargeLevel) {
    float dx = attractor.x - x;
    float dy = attractor.y - y;
    float d = mag(dx, dy) + 0.001;

    // 軌道半径・引力はフレーム不変（メインの draw() が 1 回だけ算出済み）
    if (d > frameMinOrbit) {
      vx += (dx / d) * framePullStrength;
      vy += (dy / d) * framePullStrength;
    } else {
      // 軌道内では反発ジッターに切り替え、収束しすぎを防ぐ
      float jitter = JITTER_AMOUNT * chargeLevel;
      vx += random(-jitter, jitter);
      vy += random(-jitter, jitter);
    }

    vx *= CHARGE_DAMPING;
    vy *= CHARGE_DAMPING;
  }

  private void wrapEdges() {
    if (x < 0) x += width;
    if (x > width) x -= width;
    if (y < 0) y += height;
    if (y > height) y -= height;
  }

  void display(int pState, float chargeLevel, float ampSmoothed) {
    // alpha は colorMode(HSB, 360, 100, 100, 100) のレンジ ─ 最大 100（255 ではない）
    float bri = briBase;
    float alphaVal = 22;
    float sizeMul = 1.0;

    if (pState == STATE_IDLE) {
      bri = briBase * 0.5;
      alphaVal = 18;
    } else if (pState == STATE_CHARGING) {
      bri = lerp(briBase * 0.6, 100, chargeLevel);
      alphaVal = lerp(28, 88, chargeLevel);
      sizeMul = lerp(1.0, 1.6, chargeLevel);
    } else if (pState == STATE_RELEASING) {
      bri = 100;
      alphaVal = 95;
      sizeMul = 1.8;
    } else if (pState == STATE_DECAY) {
      float speedNorm = constrain(mag(vx, vy) / DECAY_SPEED_REF, 0, 1);
      bri = lerp(briBase * 0.5, 100, speedNorm);
      bri = min(100, bri + ampSmoothed * 25); // /sc/amp によるグロー脈動
      alphaVal = lerp(20, 82, speedNorm);
    }

    // ellipse より大幅に軽い GL ポイント描画（P2D では点スプライトになる）
    stroke(hueVal, satVal, bri, alphaVal);
    strokeWeight(baseSize * sizeMul);
    point(x, y);
  }
}
