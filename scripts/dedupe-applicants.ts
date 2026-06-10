/**
 * One-time maintenance: backfill 지원번호(external_id) on existing applicants, collapse duplicates
 * (same 지원번호 uploaded more than once → keep the newest), and re-enqueue the survivors so the
 * fixed near-duplicate aggregation reruns and stale false flags clear.
 *
 *   npx tsx scripts/dedupe-applicants.ts
 *
 * Going forward the upload route upserts by 지원번호, so duplicates no longer accumulate; this is
 * just for rows created before that change.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { applicants } from '@/db/schema';
import { parseApplicantFolder } from '@/lib/filename';
import { normalizeName } from '@/lib/names';
import { enqueueApplicant } from '@/worker/queue';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/uploads';

async function main() {
  const db = getDb();
  // Newest first, so the first time we see a dedup key it is the row we keep.
  const rows = await db.select().from(applicants).orderBy(desc(applicants.createdAt));

  // 1. Backfill external_id / clean display name from the stored name where it carries a 지원번호.
  for (const a of rows) {
    const parsed = parseApplicantFolder(a.name);
    // Only when the "id (name)" pattern matched — a bare name is not a 지원번호.
    const ext = parsed.applicantName ? parsed.applicantId?.trim() || null : null;
    if (ext && a.externalId !== ext) {
      const round = ext.includes('-') ? ext.split('-')[0] : null;
      const name = parsed.applicantName ?? a.name;
      await db
        .update(applicants)
        .set({ externalId: ext, name, recruitmentRound: round })
        .where(eq(applicants.id, a.id));
      a.externalId = ext;
      a.name = name;
      console.log(`backfilled ${a.id.slice(0, 8)} → ext=${ext} name=${name}`);
    }
  }

  // 2. Group by 지원번호 (or normalized name when none); rows are newest-first so ids[0] is kept.
  const groups = new Map<string, string[]>();
  for (const a of rows) {
    const key = a.externalId ? `ext:${a.externalId}` : `name:${normalizeName(a.name)}`;
    const ids = groups.get(key) ?? [];
    ids.push(a.id);
    groups.set(key, ids);
  }
  const duplicates: string[] = [];
  const reprocess: string[] = []; // only survivors that actually had duplicates
  for (const ids of groups.values()) {
    const [survivor, ...dups] = ids;
    if (dups.length) {
      duplicates.push(...dups);
      reprocess.push(survivor);
    }
  }

  // 3. Delete duplicates — FK cascade clears documents/persons/aggregates/flags — and remove files.
  for (const id of duplicates) {
    await db.delete(applicants).where(eq(applicants.id, id));
    rmSync(join(UPLOAD_DIR, id), { recursive: true, force: true });
    console.log(`removed duplicate ${id.slice(0, 8)}`);
  }

  // 4. Re-enqueue only the deduped survivors so the corrected aggregation (jamo-level near-dup)
  //    is applied where stale flags lived. Untouched applicants refresh on their next upload.
  for (const id of reprocess) {
    const jobId = await enqueueApplicant(db, id);
    console.log(`re-enqueued ${id.slice(0, 8)} → job ${jobId.slice(0, 8)}`);
  }
  console.log(
    `\ndone: ${duplicates.length} duplicates removed, ${reprocess.length} survivor(s) re-enqueued`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
