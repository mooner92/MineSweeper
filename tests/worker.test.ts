import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applicants, documents, jobs, personAggregates, reviewFlags } from '@/db/schema';
import type { Extractor } from '@/lib/pipeline/types';
import { runWorkerTick } from '@/worker';
import { enqueueApplicant } from '@/worker/queue';
import { ARTICLE_EN, THESIS_KO } from './fixtures';
import { freshDb } from './helpers/db';

describe('worker', () => {
  it('processes a queued applicant end-to-end and persists results', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'ms-worker-'));
    const thesisPath = join(dir, '0323-000001_[학위논문]_thesis.txt');
    const articlePath = join(dir, '0323-000001_[학술논문]_article.txt');
    const hindexPath = join(dir, '0323-000001_hindex.png');
    writeFileSync(thesisPath, THESIS_KO);
    writeFileSync(articlePath, ARTICLE_EN);
    writeFileSync(hindexPath, 'fake png');

    const applicantId = 'app-1';
    await db.insert(applicants).values({ id: applicantId, name: 'Seonju Jang' });
    await db.insert(documents).values([
      {
        applicantId,
        folderCategory: '논문첨부',
        sourceFormat: 'text',
        filename: '0323-000001_[학위논문]_thesis.txt',
        filepath: thesisPath,
      },
      {
        applicantId,
        folderCategory: '학술지 게재',
        sourceFormat: 'text',
        filename: '0323-000001_[학술논문]_article.txt',
        filepath: articlePath,
      },
      {
        applicantId,
        folderCategory: '기타서류',
        sourceFormat: 'image',
        filename: '0323-000001_hindex.png',
        filepath: hindexPath,
      },
    ]);

    const jobId = await enqueueApplicant(db, applicantId);
    const processed = await runWorkerTick(db);
    expect(processed).toBe(jobId);

    const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
    expect(job?.status).toBe('done');
    expect(job?.progress).toBe(100);

    const aggs = await db
      .select()
      .from(personAggregates)
      .where(eq(personAggregates.applicantId, applicantId));
    expect(aggs.length).toBeGreaterThan(0);
    expect(aggs.find((a) => a.canonicalName === '정주철')?.roles).toContain('supervisor');

    // The image-only hindex doc produces a document-level needs_vision flag.
    const flags = await db
      .select()
      .from(reviewFlags)
      .where(eq(reviewFlags.applicantId, applicantId));
    expect(flags.some((f) => f.flagType === 'needs_vision')).toBe(true);

    // Queue is now empty.
    expect(await runWorkerTick(db)).toBeNull();
  });

  it('creates a handwriting review flag for handwritten persons (VLM-path source kind)', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'ms-worker-hw-'));
    const docPath = join(dir, '0323-000001_[학위논문]_thesis.txt');
    writeFileSync(docPath, THESIS_KO);

    const handwritingExtractor: Extractor = {
      name: 'fake-handwriting',
      async extract() {
        return [
          { nameRaw: '홍길동', role: 'committee', sourceKind: 'handwritten', sourcePage: 1, confidence: 0.95 },
        ];
      },
    };

    const applicantId = 'app-2';
    await db.insert(applicants).values({ id: applicantId, name: '장선주' });
    await db.insert(documents).values({
      applicantId,
      folderCategory: '논문첨부',
      sourceFormat: 'text',
      filename: '0323-000001_[학위논문]_thesis.txt',
      filepath: docPath,
    });

    await enqueueApplicant(db, applicantId);
    await runWorkerTick(db, handwritingExtractor);

    const flags = await db
      .select()
      .from(reviewFlags)
      .where(eq(reviewFlags.applicantId, applicantId));
    expect(flags.some((f) => f.flagType === 'handwriting')).toBe(true);
  });
});
