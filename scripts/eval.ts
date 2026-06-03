import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { documents, extractedPersons } from '@/db/schema';
import { DOC_TYPE_LABELS_KO } from '@/lib/domain';

/**
 * Human-review-volume BASELINE (Phase 1.5a).
 *
 * Prints, per (docType × sourceKind), how many extracted persons currently require human review
 * (needsHuman). This is the denominator for the Phase-1.5b go/no-go gate in
 * docs/improvement-plan-ocr.md: 1.5b (dedicated OCR sidecar) is only worth building if it cuts
 * the handwriting/image review volume by ≥30% WITHOUT abstain-recall dropping below 0.95.
 *
 * Zero new dependencies — reads the existing libsql DB. Run: `npm run eval`.
 */

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      docType: documents.docType,
      sourceKind: extractedPersons.sourceKind,
      total: sql<number>`count(*)`,
      needs: sql<number>`sum(case when ${extractedPersons.needsHuman} then 1 else 0 end)`,
    })
    .from(extractedPersons)
    .innerJoin(documents, eq(extractedPersons.documentId, documents.id))
    .groupBy(documents.docType, extractedPersons.sourceKind);

  // eslint-disable-next-line no-console
  console.log('\n=== 검토량 baseline (Phase 1.5a) — extracted_persons by category ===');
  // eslint-disable-next-line no-console
  console.log('go/no-go 게이트(improvement-plan-ocr.md §4): 1.5b는 손글씨/이미지 카테고리 검토량');
  // eslint-disable-next-line no-console
  console.log('≥30% 감소 AND abstain-recall ≥0.95 일 때만 진입.\n');

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('(추출된 인물이 없습니다 — DB가 비었거나 아직 처리 전. baseline = 0)');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(pad('docType', 24) + pad('sourceKind', 14) + pad('total', 8) + pad('needsHuman', 12) + 'review%');
  // eslint-disable-next-line no-console
  console.log('-'.repeat(64));
  let gTotal = 0;
  let gNeeds = 0;
  for (const r of rows) {
    const total = Number(r.total);
    const needs = Number(r.needs);
    gTotal += total;
    gNeeds += needs;
    const pct = total ? Math.round((needs / total) * 100) : 0;
    const label = DOC_TYPE_LABELS_KO[r.docType] ?? r.docType;
    // eslint-disable-next-line no-console
    console.log(pad(label, 24) + pad(r.sourceKind, 14) + pad(total, 8) + pad(needs, 12) + `${pct}%`);
  }
  // eslint-disable-next-line no-console
  console.log('-'.repeat(64));
  const gPct = gTotal ? Math.round((gNeeds / gTotal) * 100) : 0;
  // eslint-disable-next-line no-console
  console.log(pad('TOTAL', 38) + pad(gTotal, 8) + pad(gNeeds, 12) + `${gPct}%`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
