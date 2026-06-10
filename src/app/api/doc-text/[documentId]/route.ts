import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { documents } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extracted plain text of an HWP/HWPX/text document — the read-only "viewer" for formats the
 * browser cannot render. Reuses the pipeline's pure-Node HWP parser (no converter, no sudo).
 * 원문 레이아웃·도장은 보여줄 수 없으므로 UI는 다운로드 버튼을 함께 제공한다.
 */
export async function GET(_req: Request, { params }: { params: { documentId: string } }) {
  const db = getDb();
  const doc = (
    await db.select().from(documents).where(eq(documents.id, params.documentId)).limit(1)
  )[0];
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (doc.sourceFormat !== 'hwp' && doc.sourceFormat !== 'text') {
    return NextResponse.json({ error: 'no text view for this format' }, { status: 400 });
  }

  try {
    // Dynamic import keeps the parser out of routes that never need it.
    const { ingest } = await import('@/lib/pipeline/ingest');
    const result = await ingest(doc.filepath, doc.sourceFormat);
    const text = result.pages
      .map((p) => p.text)
      .join('\n\n')
      .trim();
    return NextResponse.json({
      filename: doc.filename,
      format: doc.sourceFormat,
      text,
      note: result.note ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `텍스트 추출 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
