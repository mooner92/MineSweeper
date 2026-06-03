import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { documents } from '@/db/schema';

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

export async function GET(_req: Request, { params }: { params: { documentId: string } }) {
  const db = getDb();
  const doc = (
    await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
  )[0];
  if (!doc) return new NextResponse('not found', { status: 404 });

  // Path comes from the DB (set during a controlled unzip), never from user input.
  const buf = await readFile(doc.filepath).catch(() => null);
  if (!buf) return new NextResponse('file missing', { status: 404 });

  const type = MIME[extname(doc.filepath).toLowerCase()] ?? 'application/octet-stream';
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=60' },
  });
}
