#!/usr/bin/env bash
# Wire the GPU-model exporter (host :9836) into the root-owned monitoring stack.
# Idempotent. Needs root (touches /data/monitoring + ufw + docker).
#   sudo bash /gits/MineSweeper/deploy/wire-gpu-exporter.sh
set -uo pipefail

PROM=/data/monitoring/prometheus.yml
COMPOSE=/data/monitoring/docker-compose.yml
PORT=9836

if [ "$(id -u)" -ne 0 ]; then echo "ERROR: run with sudo"; exit 1; fi

# 1) Allow the dockerized Prometheus (private bridge subnets) to reach the host exporter.
ufw allow from 172.16.0.0/12 to any port "$PORT" proto tcp 2>/dev/null && echo "[ufw] allowed 172.16/12 -> $PORT" || true

# 2) Find the gateway the prometheus container uses to reach the host (fallback 172.18.0.1).
PROM_CID=$(docker ps -qf name=prometheus | head -1)
GW=""
[ -n "$PROM_CID" ] && GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "$PROM_CID" 2>/dev/null | awk '{print $1}')
[ -z "$GW" ] && GW=172.18.0.1
echo "[net] prometheus -> host gateway: $GW"

# 3) Add the scrape job if not already present.
if grep -q "gpu-model-exporter" "$PROM"; then
  echo "[prom] scrape job already present — skipping"
else
  printf "\n  - job_name: 'gpu-model-exporter'\n    static_configs:\n      - targets: ['%s:%s']\n" "$GW" "$PORT" >> "$PROM"
  echo "[prom] added scrape job -> $GW:$PORT"
fi

# 4) Restart Prometheus to pick up the config.
docker compose -f "$COMPOSE" restart prometheus 2>/dev/null \
  || docker restart "$PROM_CID" 2>/dev/null
echo "[prom] restarted"

# 5) Verify the target is being scraped.
sleep 6
if curl -s "http://localhost:9090/api/v1/targets" 2>/dev/null | grep -q 'gpu-model-exporter'; then
  health=$(curl -s "http://localhost:9090/api/v1/targets" | grep -o '"job":"gpu-model-exporter".*"health":"[a-z]*"' | grep -o 'health":"[a-z]*"' | head -1)
  echo "[verify] target present — $health   (UP면 성공)"
else
  echo "[verify] 타겟 미확인 — http://<host>:9090/targets 에서 gpu-model-exporter 상태 확인. DOWN이면 GW($GW) 조정 필요."
fi
