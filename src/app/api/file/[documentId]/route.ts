import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { documents } from '@/db/schema';
import { readableName } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export async function GET(req: Request, { params }: { params: { documentId: string } }) {
  const db = getDb();
  const doc = (
    await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
  )[0];
  if (!doc) return new NextResponse('not found', { status: 404 });

  // Path comes from the DB (set during a controlled unzip), never from user input.
  const buf = await readFile(doc.filepath).catch(() => null);
  if (!buf) return new NextResponse('file missing', { status: 404 });

  const ext = extname(doc.filepath).toLowerCase(); // '.hwp', '.pdf', ...
  const type = MIME[ext] ?? 'application/octet-stream';
  // PDFs/images open inline (so the page anchor works); everything else (hwp/hwpx/…) downloads.
  // ?download=1 forces attachment regardless (뷰어 패널의 다운로드 버튼).
  const forceDownload = new URL(req.url).searchParams.get('download') === '1';
  const inline =
    !forceDownload &&
    (type.startsWith('image/') || type === 'application/pdf' || type.startsWith('text/'));

  // Download filename MUST carry the extension so the OS opens it (e.g. .hwp → 한글). Use the
  // readable original name when possible; otherwise a clean synthetic. Encode for non-ASCII names.
  const downloadName = readableName(doc.filename) ?? `document-${doc.id.slice(0, 8)}${ext}`;
  const ascii = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || `document${ext}`;
  const disposition =
    `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; ` +
    `filename*=UTF-8''${encodeURIComponent(downloadName)}`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': type,
      'content-disposition': disposition,
      'cache-control': 'private, max-age=60',
    },
  });
}
