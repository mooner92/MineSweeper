import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { applicants, documents, type NewDocument } from '@/db/schema';
import { parseApplicantFolder } from '@/lib/filename';
import { detectFormat } from '@/lib/pipeline/ingest/detect';
import { unzipApplicant } from '@/lib/unzip';
import { enqueueApplicant } from '@/worker/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'a zip file field "file" is required' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const db = getDb();
  const applicantId = crypto.randomUUID();
  const baseDir = join(UPLOAD_DIR, applicantId);
  mkdirSync(baseDir, { recursive: true });

  const zipPath = join(baseDir, 'upload.zip');
  writeFileSync(zipPath, Buffer.from(await file.arrayBuffer()));

  const extractDir = join(baseDir, 'files');
  let extracted: ReturnType<typeof unzipApplicant>;
  try {
    extracted = unzipApplicant(zipPath, extractDir);
  } catch (err) {
    console.error('[upload] unzip failed', err);
    return NextResponse.json(
      { error: `zip 처리 실패: ${(err as Error).message}` },
      { status: 422 },
    );
  }
  const { applicantFolder, files } = extracted;
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'zip 안에서 처리할 파일을 찾지 못했습니다 (빈 압축이거나 인식 가능한 문서 없음)' },
      { status: 422 },
    );
  }
  // Identify the applicant from the folder name first, then the zip filename — both carry the
  // 지원번호 ("2401-000050 (김철수)" or "2401-000050(김철수).zip").
  const parsed = parseApplicantFolder(
    applicantFolder ?? file.name.replace(/\.zip$/i, ''),
  );
  // Only treat it as a 지원번호 when the "id (name)" pattern actually matched (applicantName present);
  // a bare "오지은" is a name, not an id, and must NOT dedup against other bare names.
  const externalId = parsed.applicantName ? parsed.applicantId?.trim() || null : null;
  const applicantName = parsed.applicantName ?? file.name.replace(/\.zip$/i, '');
  const recruitmentRound = externalId?.includes('-') ? externalId.split('-')[0] : null;

  // Re-upload of the same 지원번호 REPLACES the prior applicant (user-chosen "덮어쓰기" policy):
  // drop the old applicant row — FK cascade clears its documents/persons/aggregates/flags — and
  // remove its files on disk. Zips without a parseable 지원번호 always create a new record
  // (a bare name like "김철수" is unsafe to dedup on — 동명이인).
  if (externalId) {
    const priors = await db
      .select({ id: applicants.id })
      .from(applicants)
      .where(eq(applicants.externalId, externalId));
    for (const prior of priors) {
      await db.delete(applicants).where(eq(applicants.id, prior.id));
      rmSync(join(UPLOAD_DIR, prior.id), { recursive: true, force: true });
    }
  }

  await db
    .insert(applicants)
    .values({ id: applicantId, name: applicantName, externalId, recruitmentRound });

  const docRows: NewDocument[] = files.flatMap((f) => {
    const fmt = detectFormat(f.filepath);
    if (!fmt) return [];
    return [
      {
        applicantId,
        folderCategory: f.folderCategory,
        sourceFormat: fmt,
        filename: f.relativePath.split('/').pop() ?? f.relativePath,
        filepath: f.filepath,
      },
    ];
  });
  if (docRows.length) await db.insert(documents).values(docRows);

  const jobId = await enqueueApplicant(db, applicantId);
  return NextResponse.json({ applicantId, jobId, documentCount: docRows.length });
}
