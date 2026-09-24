#!/usr/bin/env bash
# Heartburst 一括起動: SuperCollider → (Tidal) → Processing
# Tier 1 のみ起動: ./bin/start.sh --no-tidal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCLANG="/Applications/SuperCollider.app/Contents/MacOS/sclang"
PROCESSING="/Applications/Processing.app/Contents/MacOS/Processing"
LOG_DIR="/tmp/heartburst"
mkdir -p "$LOG_DIR"

USE_TIDAL=1
[[ "${1:-}" == "--no-tidal" ]] && USE_TIDAL=0

PIDS=()
cleanup() {
  echo "shutting down..."
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  pkill -f scsynth 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# 1. SuperCollider（SynthDef + SuperDirt ホスト）
echo "[1/3] SuperCollider starting..."
"$SCLANG" "$ROOT/sc/main.scd" > "$LOG_DIR/sc.log" 2>&1 &
PIDS+=($!)

# ready 行が出るまで待つ（最大 30 秒）
for i in $(seq 1 30); do
  grep -q "Heartburst audio ready" "$LOG_DIR/sc.log" 2>/dev/null && break
  sleep 1
done
grep -q "Heartburst audio ready" "$LOG_DIR/sc.log" || {
  echo "ERROR: SuperCollider が起動しない。$LOG_DIR/sc.log を確認"; cleanup
}
echo "      SuperCollider ready"

# 2. Tidal Cycles（パターン層 ─ オプショナル）
if [[ $USE_TIDAL -eq 1 ]]; then
  BOOT_TIDAL="$ROOT/tidal/BootTidal.hs"
  if [[ -f "$BOOT_TIDAL" ]] && command -v ghci >/dev/null; then
    echo "[2/3] Tidal starting..."
    # ghci は stdin が EOF になると終了するため、tail -f /dev/null で開きっぱなしにする
    (cd "$ROOT" && tail -f /dev/null | ghci -v0 -ghci-script "$BOOT_TIDAL" -ghci-script "$ROOT/tidal/performance.tidal" \
      > "$LOG_DIR/tidal.log" 2>&1) &
    PIDS+=($!)
    sleep 3
  else
    echo "[2/3] Tidal skip（BootTidal.hs か ghci が無い ─ Tier 1 で続行）"
  fi
else
  echo "[2/3] Tidal skip（--no-tidal）"
fi

# 3. Processing（ビジュアル + 入力）
echo "[3/3] Processing starting..."
"$PROCESSING" cli --sketch="$ROOT/processing/Heartburst" --run > "$LOG_DIR/processing.log" 2>&1 &
PIDS+=($!)

echo ""
echo "Heartburst 起動完了。ウィンドウを閉じるか Ctrl+C で全プロセス終了"
echo "ログ: $LOG_DIR/{sc,tidal,processing}.log"
wait
cleanup
