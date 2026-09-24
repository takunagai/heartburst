// ============================================================
// Shockwave ─ 衝撃波リング
//
// release 時に爆心座標へ 1 個 spawn。半径膨張・線幅とアルファの
// 減衰で「空気の壁」感を表現する。配列使い回し（非活性個体を再利用）。
// ============================================================

class Shockwave {

  boolean active = false;
  float x, y;
  float radius;
  float maxRadius;
  float strokeW;
  float alphaVal;

  void start(float px, float py, float level) {
    active = true;
    x = px;
    y = py;
    radius = 8;
    maxRadius = lerp(SHOCKWAVE_RADIUS_MIN, SHOCKWAVE_RADIUS_MAX, level);
    strokeW = lerp(3, 16, level);
    alphaVal = 100; // colorMode の alpha レンジは 100
  }

  void update() {
    if (!active) return;
    radius += (maxRadius - radius) * 0.08 + 6;
    strokeW *= 0.965;
    alphaVal *= 0.93;
    if (alphaVal < 1.5 || radius >= maxRadius) {
      active = false;
    }
  }

  void display() {
    if (!active) return;
    noFill();
    stroke(190, 70, 100, alphaVal); // シアン寄りの発光リング
    strokeWeight(max(0.5, strokeW));
    ellipse(x, y, radius * 2, radius * 2);
  }
}
