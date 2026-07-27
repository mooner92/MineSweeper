import { count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { reviewFlags } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 헤더 내비 '검토 큐' 배지용 열린 항목 수 — getReviewQueue와 같은 모집단(open review_flags). */
export async function GET() {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(reviewFlags)
    .where(eq(reviewFlags.status, 'open'));
  return NextResponse.json({ open: row?.n ?? 0 });
}
