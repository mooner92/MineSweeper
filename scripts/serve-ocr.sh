#!/usr/bin/env bash
# Serve the OCR ensemble: 3 local vLLM OpenAI-compatible servers (ports 8010/8011/8012).
#
# LOCAL ONLY — no external API. After these are up, point the app at them:
#   EXTRACTOR_MODE=ensemble
#   VLM_ENSEMBLE="http://localhost:8010/v1|$MODEL1,http://localhost:8011/v1|$MODEL2,http://localhost:8012/v1|$MODEL3"
#
# ⚠️ GPU PRECONDITION: each ~7–9B VLM needs ~16–20GB VRAM (×3 ≈ 48–60GB). This box has 2×A40
#    (46GB each). As of this writing BOTH are occupied by a SHARED vLLM (Qwen2.5-Coder-32B,
#    another user) — only ~6GB free per card. DO NOT run this until a GPU window is free, and do
#    NOT kill the shared service. The script refuses to start if free VRAM is insufficient.
#
# Model choices are RECOMMENDED defaults — verify vLLM support + Korean/seal accuracy on the
# real labelset (see docs/improvement-plan-ocr.md §평가). Override via env: MODEL1/MODEL2/MODEL3.
set -euo pipefail

VLLM="${VLLM_BIN:-/data/vllm/env/bin/vllm}"
API_KEY="${VLM_API_KEY:-local}"
MAX_LEN="${VLM_MAX_MODEL_LEN:-16384}"
GPU_UTIL="${VLM_GPU_UTIL:-0.30}"           # per-server fraction; tune to fit alongside others
MIN_FREE_MIB="${MIN_FREE_MIB:-16000}"      # require this much free VRAM before starting

MODEL1="${MODEL1:-Qwen/Qwen2.5-VL-7B-Instruct}"
MODEL2="${MODEL2:-OpenGVLab/InternVL3-8B}"
MODEL3="${MODEL3:-zai-org/GLM-4.1V-9B-Thinking}"

echo "vLLM binary : $VLLM"
[ -x "$VLLM" ] || { echo "ERROR: vllm not found at $VLLM (set VLLM_BIN)"; exit 1; }

# --- VRAM guard: refuse to start on a saturated/shared GPU ---
free_mib="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | sort -rn | head -1 || echo 0)"
echo "Max free VRAM on a single GPU: ${free_mib} MiB (need >= ${MIN_FREE_MIB})"
if [ "${free_mib:-0}" -lt "$MIN_FREE_MIB" ]; then
  echo "ABORT: insufficient free VRAM. Both A40s are likely held by the shared Qwen-Coder vLLM."
  echo "Free a GPU window (do NOT kill others' services) and re-run."
  exit 2
fi

mkdir -p ./data/logs
serve() { # port model gpu
  local port="$1" model="$2" gpu="$3"
  echo "→ serving $model on :$port (CUDA_VISIBLE_DEVICES=$gpu)"
  CUDA_VISIBLE_DEVICES="$gpu" "$VLLM" serve "$model" \
    --port "$port" --api-key "$API_KEY" \
    --max-model-len "$MAX_LEN" --gpu-memory-utilization "$GPU_UTIL" \
    --trust-remote-code \
    > "./data/logs/vllm-$port.log" 2>&1 &
  echo "   pid $! (log: ./data/logs/vllm-$port.log)"
}

# Spread across whichever GPUs are free (edit GPU ids to match your free cards).
serve 8010 "$MODEL1" "${GPU1:-0}"
serve 8011 "$MODEL2" "${GPU2:-1}"
serve 8012 "$MODEL3" "${GPU3:-1}"

cat <<EOF

Started 3 vLLM servers. Wait for "Application startup complete" in ./data/logs/vllm-80{10,11,12}.log,
then set in the app environment:
  EXTRACTOR_MODE=ensemble
  VLM_ENSEMBLE="http://localhost:8010/v1|$MODEL1,http://localhost:8011/v1|$MODEL2,http://localhost:8012/v1|$MODEL3"
  VLM_API_KEY=$API_KEY
and restart the worker:  pm2 restart minesweeper-worker --update-env
Smoke test one endpoint:  curl -s http://localhost:8010/v1/models -H "authorization: Bearer $API_KEY"
EOF
