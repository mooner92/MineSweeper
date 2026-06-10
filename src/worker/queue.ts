import { eq } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { jobs, type Job } from '@/db/schema';

/** Insert a process-applicant job. Returns the new job id. */
export async function enqueueApplicant(db: DB, applicantId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(jobs).values({
    id,
    type: 'process_applicant',
    status: 'queued',
    payload: { applicantId },
    progress: 0,
  });
  return id;
}

/**
 * Re-queue jobs orphaned by a worker crash/restart. Single-worker model: any row still
 * 'running' at boot belongs to a dead process (claimNextJob never re-picks 'running'),
 * so without this the job — and the applicant's "추출 running" header — hangs forever.
 */
export async function recoverOrphanedJobs(db: DB): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(eq(jobs.status, 'running'))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Atomically-ish claim the oldest queued job (single-worker model) and mark it running. */
export async function claimNextJob(db: DB): Promise<Job | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(jobs.createdAt)
    .limit(1);
  const job = rows[0];
  if (!job) return null;

  const attempts = job.attempts + 1;
  await db
    .update(jobs)
    .set({ status: 'running', attempts, updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  return { ...job, status: 'running', attempts };
}

export async function completeJob(db: DB, id: string, progress = 100): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', progress, error: null, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

export async function failJob(db: DB, id: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'error', error, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}
