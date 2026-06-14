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

  // 동일소속기관(same_affiliation) 판정 기준 — self 행을 걸러내기 전에 본인 소속을 수집한다.
  const selfAffiliations = rows.filter((r) => r.isSelf).map((r) => r.affiliation);

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
      nameCandidates: r.nameCandidates,
    }));

  if (format === 'xlsx') {
    const buf = await toXlsxBuffer(visible, { selfAffiliations });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="relations-${params.applicantId}.xlsx"`,
      },
    });
  }

  const csv = toCsv(visible, { selfAffiliations });
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="relations-${params.applicantId}.csv"`,
    },
  });
}
