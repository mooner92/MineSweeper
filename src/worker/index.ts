import { pathToFileURL } from 'node:url';
import { getDb, type DB } from '@/db/client';
import type { Extractor } from '@/lib/pipeline/types';
import { cleanupCaches } from './cleanup';
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

  // 디스크 하우스키핑(렌더 캐시 만료·고아 크롭 제거) — 부팅 직후 1회 + 6시간마다.
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let lastCleanup = 0;

  for (;;) {
    if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
      lastCleanup = Date.now();
      try {
        const { renders, crops } = await cleanupCaches(db);
        if (renders + crops > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker] cache cleanup: renders=${renders} crops=${crops} removed`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[worker] cache cleanup failed:', err);
      }
    }

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
