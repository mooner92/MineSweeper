// PM2 process definitions for Minesweeper.
// Start:   pm2 start ecosystem.config.cjs && pm2 save
// Logs:    pm2 logs minesweeper-web   |   pm2 logs minesweeper-worker
// Both processes run from this directory so the relative ./data paths resolve correctly.

const path = require('node:path');
const cwd = __dirname;

// Shared environment. Flip EXTRACTOR_MODE to 'vlm' to use the on-prem Ollama model.
const env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'file:./data/minesweeper.db',
  UPLOAD_DIR: './data/uploads',
  EXTRACTOR_MODE: 'stub',
  VLM_BASE_URL: 'http://localhost:11434/v1',
  VLM_API_KEY: 'ollama',
  VLM_MODEL: 'qwen3.5:9B',
  VLM_TIMEOUT_MS: '120000',
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
