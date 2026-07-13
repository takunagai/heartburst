// ============================================================
// OscBridge ─ OSC 送受信の集約
//
// 送信先:
//   SuperCollider : 127.0.0.1:57120  (/charge/start, /charge/level, /release, /pop)
//   Tidal Cycles  : 127.0.0.1:6010   (/ctrl "charge"|"energy", float)
// 受信:
//   ポート 12000 で /sc/amp (float) を受信し、Lerp で平滑化して保持する
//
// 受信側プロセスが未起動でも oscP5.send() は UDP のコネクションレス送信
// なので例外は投げない想定だが、念のため try-catch でスケッチ停止を防ぐ。
// ============================================================

class OscBridge {

  OscP5 oscP5;
  NetAddress scAddr;
  NetAddress tidalAddr;

  float ampRaw = 0;       // /sc/amp の生値
  float ampSmoothed = 0;  // Lerp 平滑化後（グロー脈動係数として使用）

  OscBridge(Object parent, int receivePort, String scHost, int scPort, String tidalHost, int tidalPort) {
    oscP5 = new OscP5(parent, receivePort);
    scAddr = new NetAddress(scHost, scPort);
    tidalAddr = new NetAddress(tidalHost, tidalPort);
  }

  // ---- 送信: SuperCollider ----

  void sendChargeStart(float normX, float normY) {
    OscMessage m = new OscMessage("/charge/start");
    m.add(normX);
    m.add(normY);
    sendSafe(m, scAddr);
  }

  void sendChargeLevel(float level) {
    OscMessage m = new OscMessage("/charge/level");
    m.add(level);
    sendSafe(m, scAddr);
  }

  void sendRelease(float level, float normX, float normY) {
    OscMessage m = new OscMessage("/release");
    m.add(level);
    m.add(normX);
    m.add(normY);
    sendSafe(m, scAddr);
  }

  void sendPop(float normX, float normY) {
    OscMessage m = new OscMessage("/pop");
    m.add(normX);
    m.add(normY);
    sendSafe(m, scAddr);
  }

  // ---- 送信: Tidal Cycles (/ctrl "key" value ─ typetag "sf") ----

  void sendCtrlCharge(float level) {
    sendCtrl("charge", level);
  }

  void sendCtrlEnergy(float energy) {
    sendCtrl("energy", energy);
  }

  private void sendCtrl(String key, float value) {
    OscMessage m = new OscMessage("/ctrl");
    m.add(key);
    m.add(value);
    sendSafe(m, tidalAddr);
  }

  // ---- 共通送信（失敗してもスケッチを落とさない） ----

  private void sendSafe(OscMessage msg, NetAddress addr) {
    try {
      oscP5.send(msg, addr);
    } catch (Exception e) {
      println("[OscBridge] 送信失敗（受信側未起動の可能性）: " + e.getMessage());
    }
  }

  // ---- 受信: SuperCollider → Processing ----
  // oscP5 はコンストラクタに渡したオブジェクト（ここではメインスケッチ = PApplet）
  // に対して public な oscEvent(OscMessage) をリフレクションで探して呼び出す。
  // そのためイベントの入口は CatharsisField.pde 側の oscEvent() に置き、
  // そこから本メソッドへ橋渡しする（受信データの保持・平滑化はここに集約）。

  void handleIncoming(OscMessage msg) {
    if (msg.checkAddrPattern("/sc/amp")) {
      try {
        ampRaw = msg.get(0).floatValue();
      } catch (Exception e) {
        // 型が想定と違う場合は無視（脈動が一瞬止まる程度で致命的ではない）
      }
    }
  }

  // 毎フレーム呼び出し、平滑化を進める
  void updateSmoothing() {
    ampSmoothed = lerp(ampSmoothed, ampRaw, 0.15);
  }

  float getAmp() {
    return ampSmoothed;
  }

  void close() {
    try {
      oscP5.stop();
    } catch (Exception e) {
      // 終了処理の失敗は無視してよい
    }
  }
}
