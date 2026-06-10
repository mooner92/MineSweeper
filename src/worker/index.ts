import { pathToFileURL } from 'node:url';
import { getDb, type DB } from '@/db/client';
import type { Extractor } from '@/lib/pipeline/types';
import { claimNextJob, completeJob, failJob, recoverOrphanedJobs } from './queue';
import { processApplicant } from './process';

/** Process at most one queued job. Returns the job id processed, or null if the queue is empty. */
export async function runWorkerTick(db: DB, extractor?: Extractor): Promise<string | null> {
  const job = await claimNextJob(db);
  if (!job) return null;
  try {
    await processApplicant(db, job.payload.applicantId, extractor);
    await completeJob(db, job.id);
  } catch (err) {
    await failJob(db, job.id, err instanceof Error ? err.message : String(err));
  }
  return job.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const db = getDb();
  const interval = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
  const mode = process.env.EXTRACTOR_MODE ?? 'stub';
  // eslint-disable-next-line no-console
  console.log(`[worker] polling every ${interval}ms (extractor=${mode})`);
  // 이전 워커가 죽으며 남긴 'running' 고아 작업을 다시 큐에 — 재시작 후 영구 멈춤 방지.
  const recovered = await recoverOrphanedJobs(db);
  if (recovered > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker] re-queued ${recovered} orphaned running job(s)`);
  }
  for (;;) {
    const id = await runWorkerTick(db);
    if (id) {
      // eslint-disable-next-line no-console
      console.log(`[worker] processed job ${id}`);
    } else {
      await sleep(interval);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export { enqueueApplicant } from './queue';
export { processApplicant } from './process';
