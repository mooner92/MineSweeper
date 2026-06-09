#!/usr/bin/env python3
"""Tiny Prometheus exporter: which model is loaded on which GPU.

dcgm-exporter gives numeric GPU metrics but not *what model* occupies each GPU. This maps every
GPU compute process (vLLM / ollama) to its model + port by walking process cmdlines, and exposes:

  gpu_model_vram_bytes{gpu,model,framework,port,pid}   VRAM used by that model process
  gpu_model_info{gpu,model,framework,port,pid} 1        presence (1)

Stdlib only. Run on the host (reads /proc + nvidia-smi); Prometheus scrapes it.
  python3 gpu-model-exporter.py            # serves :9836/metrics
"""
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("GPU_MODEL_EXPORTER_PORT", "9836"))


def _run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return ""


def _cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
    except Exception:
        return ""


def _ppid(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            # ppid is field 4; comm (field 2) may contain spaces/parens, so split after ')'
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except Exception:
        return 0


def _uuid_to_index():
    out = _run(["nvidia-smi", "--query-gpu=index,uuid", "--format=csv,noheader,nounits"])
    m = {}
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2:
            m[parts[1]] = parts[0]
    return m


def _label(v):
    return str(v).replace("\\", "\\\\").replace('"', '\\"')


def _model_for_pid(pid):
    """Return (model, framework, port) by inspecting the process (and its vLLM launcher parent)."""
    cmd = _cmdline(pid)
    if "llama-server" in cmd or "ollama" in cmd:
        model = _ollama_loaded_model() or "ollama"
        return (model, "ollama", "11434")
    # vLLM workers re-title themselves; climb to the `vllm serve` launcher.
    cur = pid
    for _ in range(5):
        c = _cmdline(cur)
        if "vllm serve" in c or " serve " in c and "vllm" in c:
            served = re.search(r"--served-model-name\s+(\S+)", c)
            if not served:
                served = re.search(r"serve\s+(\S+)", c)
            model = served.group(1) if served else "vllm"
            port = re.search(r"--port\s+(\d+)", c)
            return (os.path.basename(model.rstrip("/")), "vllm", port.group(1) if port else "")
        cur = _ppid(cur)
        if cur <= 1:
            break
    return ("unknown", "unknown", "")


_OLLAMA_CACHE = {"v": None}


def _ollama_loaded_model():
    # Best-effort: ask ollama which model is currently loaded.
    import json
    import urllib.request

    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=2) as r:
            models = json.load(r).get("models", [])
            if models:
                return "ollama:" + models[0].get("name", "?")
    except Exception:
        pass
    return None


def collect():
    u2i = _uuid_to_index()
    out = _run(
        [
            "nvidia-smi",
            "--query-compute-apps=gpu_uuid,pid,used_memory",
            "--format=csv,noheader,nounits",
        ]
    )
    lines = [
        "# HELP gpu_model_vram_bytes VRAM (bytes) used by a model process, by GPU/model.",
        "# TYPE gpu_model_vram_bytes gauge",
    ]
    info = [
        "# HELP gpu_model_info Model present on a GPU (value always 1).",
        "# TYPE gpu_model_info gauge",
    ]
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 3:
            continue
        uuid, pid, mem_mib = parts
        gpu = u2i.get(uuid, "?")
        try:
            vram = int(float(mem_mib)) * 1024 * 1024
        except ValueError:
            vram = 0
        model, fw, port = _model_for_pid(pid)
        labels = (
            f'gpu="{_label(gpu)}",model="{_label(model)}",'
            f'framework="{_label(fw)}",port="{_label(port)}",pid="{_label(pid)}"'
        )
        lines.append(f"gpu_model_vram_bytes{{{labels}}} {vram}")
        info.append(f"gpu_model_info{{{labels}}} 1")
    return "\n".join(lines + info) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/metrics", "/"):
            self.send_response(404)
            self.end_headers()
            return
        body = collect().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # quiet


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
