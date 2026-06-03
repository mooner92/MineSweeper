import { desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { jobs, personAggregates } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { applicantId: string } }) {
  const db = getDb();
  const { applicantId } = params;

  const job =
    (
      await db
        .select()
        .from(jobs)
        .where(sql`json_extract(${jobs.payload}, '$.applicantId') = ${applicantId}`)
        .orderBy(desc(jobs.createdAt))
        .limit(1)
    )[0] ?? null;

  const aggregates = await db
    .select({ id: personAggregates.id })
    .from(personAggregates)
    .where(eq(personAggregates.applicantId, applicantId));

  return NextResponse.json({
    status: job?.status ?? 'unknown',
    progress: job?.progress ?? 0,
    error: job?.error ?? null,
    aggregateCount: aggregates.length,
  });
}
