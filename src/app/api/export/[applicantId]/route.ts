import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { personAggregates } from '@/db/schema';
import { toCsv, toXlsxBuffer } from '@/lib/export';
import type { AggregatedPerson } from '@/lib/pipeline/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { applicantId: string } }) {
  const db = getDb();
  const format = new URL(req.url).searchParams.get('format') ?? 'csv';

  const rows = await db
    .select()
    .from(personAggregates)
    .where(eq(personAggregates.applicantId, params.applicantId));

  // Final roster excludes the applicant themself and rejected entries.
  const visible: AggregatedPerson[] = rows
    .filter((r) => !r.isSelf && r.finalStatus !== 'rejected')
    .map((r) => ({
      canonicalName: r.canonicalName,
      nameNormalized: r.nameNormalized,
      roles: r.roles,
      sources: r.sources,
      affiliation: r.affiliation,
      isSelf: r.isSelf,
      needsHuman: r.needsHuman,
    }));

  if (format === 'xlsx') {
    const buf = await toXlsxBuffer(visible);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="relations-${params.applicantId}.xlsx"`,
      },
    });
  }

  const csv = toCsv(visible);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="relations-${params.applicantId}.csv"`,
    },
  });
}
