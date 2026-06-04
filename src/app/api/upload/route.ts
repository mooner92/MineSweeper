import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const applicantName =
    (applicantFolder ? parseApplicantFolder(applicantFolder).applicantName : null) ??
    file.name.replace(/\.zip$/i, '');

  await db.insert(applicants).values({ id: applicantId, name: applicantName });

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
