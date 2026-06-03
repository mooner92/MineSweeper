import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { reviewFlags } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Serve a review flag's cropped region image (seal/signature crop). Path is validated to stay
 *  under the local ./data directory (cropPath comes from the worker, never user input). */
export async function GET(_req: Request, { params }: { params: { flagId: string } }) {
  const db = getDb();
  const flag = (
    await db.select().from(reviewFlags).where(eq(reviewFlags.id, params.flagId)).limit(1)
  )[0];
  if (!flag?.cropPath) return new NextResponse('not found', { status: 404 });

  const dataRoot = resolve('./data');
  const target = resolve(flag.cropPath);
  if (target !== dataRoot && !target.startsWith(dataRoot + '/')) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const buf = await readFile(target).catch(() => null);
  if (!buf) return new NextResponse('missing', { status: 404 });
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=60' },
  });
}
