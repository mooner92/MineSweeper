// PM2 process definitions for Minesweeper.
// Start:   pm2 start ecosystem.config.cjs && pm2 save
// Logs:    pm2 logs minesweeper-web   |   pm2 logs minesweeper-worker
// Both processes run from this directory so the relative ./data paths resolve correctly.

const path = require('node:path');
const cwd = __dirname;

// Shared environment. EXTRACTOR_MODE controls Stage-3 name extraction.
const env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'file:./data/minesweeper.db',
  UPLOAD_DIR: './data/uploads',
  // 'vlm' = local VLM extracts every doc. Real academic author blocks (e.g. "Hyung-Min Lee a,b,
  // Rokjin J. Park a,*") and Korean thesis approval pages need an LLM; the deterministic stub
  // returns 0 on them. ('stub' = no GPU | 'hybrid' = text→stub/image→VLM | 'ensemble' = multi-model.)
  EXTRACTOR_MODE: 'vlm',
  // Local vLLM Qwen2.5-VL on GPU1 (scripts/serve-ocr or systemd). Used by DETECT_MARKS + vlm mode.
  VLM_BASE_URL: 'http://localhost:8010/v1',
  VLM_API_KEY: 'local',
  VLM_MODEL: 'Qwen2.5-VL-7B-Instruct',
  VLM_TIMEOUT_MS: '120000',
  // Seal/signature/handwriting detection (renders relevant pages → VLM locates marks → crop + flag).
  DETECT_MARKS: '1',
  // Ensemble endpoints (used only when EXTRACTOR_MODE=ensemble). All LOCAL, no external API.
  VLM_ENSEMBLE:
    'http://localhost:8010/v1|Qwen/Qwen2.5-VL-7B-Instruct,http://localhost:8011/v1|OpenGVLab/InternVL3-8B,http://localhost:8012/v1|zai-org/GLM-4.1V-9B-Thinking',
  VLM_ENSEMBLE_MIN_VOTES: '1',
  WORKER_POLL_INTERVAL_MS: '2000',
};

const PORT = process.env.MINESWEEPER_PORT || '3100';

module.exports = {
  apps: [
    {
      name: 'minesweeper-web',
      cwd,
      script: 'npm',
      args: 'start',
      env: { ...env, PORT },
      autorestart: true,
      max_restarts: 10,
      time: true,
      out_file: path.join(cwd, 'data/logs/web.out.log'),
      error_file: path.join(cwd, 'data/logs/web.err.log'),
    },
    {
      name: 'minesweeper-worker',
      cwd,
      script: 'npm',
      args: 'run worker',
      env: { ...env },
      autorestart: true,
      max_restarts: 10,
      time: true,
      out_file: path.join(cwd, 'data/logs/worker.out.log'),
      error_file: path.join(cwd, 'data/logs/worker.err.log'),
    },
  ],
};
