#!/usr/bin/env bash
# Install / repair the OCR vLLM systemd service (Qwen2.5-VL-7B on :8010, GPU1).
# Idempotent — safe to re-run. Needs root.
#
#   sudo bash /gits/MineSweeper/deploy/setup-ocr-service.sh
#
# Why a script (not a one-liner): long chained sudo commands get split by terminal
# paste/line-wrap and break mid-command. A short invocation can't be mangled.
set -uo pipefail

UNIT=vllm-ocr-8010.service
SRC="$(cd "$(dirname "$0")" && pwd)/${UNIT}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run with sudo:  sudo bash $0" >&2
  exit 1
fi

echo "[1/6] install unit file ($SRC)"
cp "$SRC" "/etc/systemd/system/${UNIT}"
systemctl daemon-reload

echo "[2/6] stop systemd-managed instance (if running)"
systemctl stop "${UNIT}" 2>/dev/null || true

echo "[3/6] kill any stray (manual/nohup) vLLM-VL processes holding :8010"
pkill -f 'vllm serve Qwen/Qwen2.5-VL-7B' 2>/dev/null || true
sleep 6

echo "[4/6] enable on boot"
systemctl enable "${UNIT}"

echo "[5/6] start a single clean instance"
systemctl start "${UNIT}"

echo "[6/6] wait for model load + port bind (up to ~180s)"
for i in $(seq 1 36); do
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
    http://localhost:8010/v1/models -H 'authorization: Bearer local' 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then echo "  :8010 OK (HTTP 200) after ~$((i*5))s"; break; fi
  sleep 5
done

echo "----- summary -----"
echo "is-enabled: $(systemctl is-enabled "${UNIT}" 2>&1)"
echo "is-active : $(systemctl is-active  "${UNIT}" 2>&1)"
systemctl --no-pager status "${UNIT}" | head -8
echo "VL processes: $(pgrep -fc 'vllm serve Qwen/Qwen2.5-VL-7B' 2>/dev/null || echo 0) (should be 1)"
