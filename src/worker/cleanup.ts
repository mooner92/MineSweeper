import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isNotNull } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { reviewFlags } from '@/db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Page renders are pure cache (re-created on demand by /api/page) — safe to age out. */
const RENDER_TTL_MS = Number(process.env.RENDER_CACHE_TTL_DAYS ?? 7) * DAY_MS;
/** Crops younger than this are never touched (a detection run may not have written its flag yet). */
const CROP_MIN_AGE_MS = 1 * DAY_MS;

/**
 * Disk housekeeping for the on-demand caches under data/uploads — without this they grow
 * forever and eventually fill the disk (uploads themselves are NOT touched; they are the
 * applicant originals and follow the applicant lifecycle).
 *
 *  - renders/: delete files older than RENDER_TTL (regenerable cache).
 *  - crops/:   delete only ORPHANS — files no review_flag references (flags display their crop,
 *              and crops are not regenerable without re-running detection).
 *
 * Resilient by design: every unlink is best-effort; a missing dir is a no-op.
 */
export async function cleanupCaches(
  db: DB,
  uploadDir = process.env.UPLOAD_DIR ?? './data/uploads',
  now = Date.now(),
): Promise<{ renders: number; crops: number }> {
  let renders = 0;
  let crops = 0;

  const rendersDir = join(uploadDir, 'renders');
  if (existsSync(rendersDir)) {
    for (const name of readdirSync(rendersDir)) {
      const p = join(rendersDir, name);
      try {
        if (now - statSync(p).mtimeMs > RENDER_TTL_MS) {
          unlinkSync(p);
          renders++;
        }
      } catch {
        // raced with a writer/another cleanup — skip
      }
    }
  }

  const cropsDir = join(uploadDir, 'crops');
  if (existsSync(cropsDir)) {
    const referenced = new Set(
      (
        await db
          .select({ cropPath: reviewFlags.cropPath })
          .from(reviewFlags)
          .where(isNotNull(reviewFlags.cropPath))
      ).map((r) => resolve(r.cropPath as string)),
    );
    for (const name of readdirSync(cropsDir)) {
      const p = join(cropsDir, name);
      try {
        if (!referenced.has(resolve(p)) && now - statSync(p).mtimeMs > CROP_MIN_AGE_MS) {
          unlinkSync(p);
          crops++;
        }
      } catch {
        // best-effort
      }
    }
  }

  return { renders, crops };
}
