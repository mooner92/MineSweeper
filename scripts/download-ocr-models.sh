#!/usr/bin/env bash
# Pre-download the OCR ensemble models into the local HF cache (no serving, no GPU needed).
#
# Uses the already-configured HF token (~/.cache/huggingface/token). LOCAL ONLY — weights are
# cached on disk and served later by scripts/serve-ocr.sh. ~15–20GB per 7–9B model (×3).
#
# NOTE: run this only after confirming the 3 model ids (verify vLLM support + Korean/seal
# accuracy on the real labelset first). Override via env MODEL1/MODEL2/MODEL3.
set -euo pipefail

HF="${HF_BIN:-/data/vllm/env/bin/hf}"
MODEL1="${MODEL1:-Qwen/Qwen2.5-VL-7B-Instruct}"
MODEL2="${MODEL2:-OpenGVLab/InternVL3-8B}"
MODEL3="${MODEL3:-zai-org/GLM-4.1V-9B-Thinking}"

[ -x "$HF" ] || { echo "ERROR: hf CLI not found at $HF (set HF_BIN)"; exit 1; }
echo "Disk free: $(df -h "$HOME" | tail -1 | awk '{print $4}')"

for m in "$MODEL1" "$MODEL2" "$MODEL3"; do
  echo "→ downloading $m ..."
  "$HF" download "$m"
done
echo "Done. Models cached under ~/.cache/huggingface/hub. Next: scripts/serve-ocr.sh"
