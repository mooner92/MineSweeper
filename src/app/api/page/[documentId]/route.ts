import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { documents } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/uploads';

/**
 * Render a single page of a document to PNG (for inline thumbnails in the review queue — e.g.
 * comparing 동명이인/약어 candidates on the exact page each name appears). On-demand + cached to
 * the same renders/ dir the detector uses, so repeat views and detector renders are shared.
 * The native renderer (canvas/pdf) is dynamically imported so other routes never bundle it.
 */
export async function GET(req: Request, { params }: { params: { documentId: string } }) {
  const page = Math.max(1, Math.min(5000, Number(new URL(req.url).searchParams.get('page')) || 1));

  const db = getDb();
  const doc = (
    await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
  )[0];
  if (!doc) return new NextResponse('not found', { status: 404 });

  // Source path must stay under ./data (filepath is DB-controlled, never user input).
  const dataRoot = resolve('./data');
  const src = resolve(doc.filepath);
  if (src !== dataRoot && !src.startsWith(dataRoot + '/')) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const cachePath = join(UPLOAD_DIR, 'renders', `${doc.id}-p${page}.png`);
  if (!existsSync(cachePath)) {
    const { renderPdfPageToPng, imageToPng } = await import('@/lib/pipeline/render');
    const rendered =
      doc.sourceFormat === 'pdf'
        ? await renderPdfPageToPng(src, page, cachePath)
        : doc.sourceFormat === 'image'
          ? await imageToPng(src, cachePath)
          : null;
    if (!rendered) return new NextResponse('cannot render', { status: 404 });
  }

  const buf = await readFile(cachePath).catch(() => null);
  if (!buf) return new NextResponse('missing', { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' },
  });
}
