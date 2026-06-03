import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { corrections, personAggregates } from '@/db/schema';
import type { ReviewStatus } from '@/lib/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  action: 'confirm' | 'exclude' | 'reject' | 'edit';
  name?: string;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const db = getDb();
  const body = (await req.json()) as Body;

  const agg = (
    await db.select().from(personAggregates).where(eq(personAggregates.id, params.id)).limit(1)
  )[0];
  if (!agg) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let finalStatus: ReviewStatus = agg.finalStatus;
  let canonicalName = agg.canonicalName;

  if (body.action === 'confirm') {
    finalStatus = 'confirmed';
  } else if (body.action === 'exclude' || body.action === 'reject') {
    finalStatus = 'rejected';
  } else if (body.action === 'edit') {
    finalStatus = 'edited';
    canonicalName = body.name?.trim() || agg.canonicalName;
  }

  await db
    .update(personAggregates)
    .set({ finalStatus, canonicalName })
    .where(eq(personAggregates.id, params.id));

  const isEdit = body.action === 'edit';
  await db.insert(corrections).values({
    applicantId: agg.applicantId,
    personId: agg.id,
    field: isEdit ? 'canonicalName' : 'finalStatus',
    oldValue: isEdit ? agg.canonicalName : agg.finalStatus,
    newValue: isEdit ? canonicalName : finalStatus,
    action: body.action === 'reject' ? 'reject' : body.action,
  });

  return NextResponse.json({ ok: true, finalStatus, canonicalName });
}
