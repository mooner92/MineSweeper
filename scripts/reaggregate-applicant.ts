/**
 * Re-run Stage-4 aggregation for an applicant from already-stored extractions — WITHOUT re-running
 * ingest/extract (no VLM, deterministic). Use after an aggregation-logic change (e.g. the jamo-level
 * near-duplicate fix) or an applicant-name cleanup (better self-exclusion) to refresh person_aggregates
 * and the 동명이인/약어 flags. Person-level flags (seal/handwriting/low_confidence/needs_vision) are
 * left untouched — they derive from extracted_persons, which this does not modify.
 *
 *   npx tsx scripts/reaggregate-applicant.ts <지원번호|applicantId|all>
 *
 * Note: the `evidence` snippet on sources is not persisted in extracted_persons, so re-aggregated
 * source tooltips fall back to the filename. A full re-upload restores it.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  applicants,
  documents,
  extractedPersons,
  personAggregates,
  reviewFlags,
} from '@/db/schema';
import { aggregate } from '@/lib/pipeline/aggregate';
import type { PersonWithSource } from '@/lib/pipeline/types';

async function reaggregate(applicantId: string, name: string) {
  const db = getDb();
  const docs = await db.select().from(documents).where(eq(documents.applicantId, applicantId));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const persons = docs.length
    ? await db
        .select()
        .from(extractedPersons)
        .where(inArray(extractedPersons.documentId, docs.map((d) => d.id)))
    : [];

  const pws: PersonWithSource[] = persons.map((p) => {
    const d = docMap.get(p.documentId)!;
    return {
      nameRaw: p.nameRaw,
      role: p.role,
      affiliation: p.affiliation,
      sourceKind: p.sourceKind,
      sourcePage: p.sourcePage,
      confidence: p.confidence,
      isSelf: p.isSelf,
      regionBbox: p.regionBbox,
      ocrEngine: p.ocrEngine,
      ocrConfidence: p.ocrConfidence,
      verificationStatus: p.verificationStatus,
      nameCandidates: p.nameCandidates ?? undefined,
      documentId: p.documentId,
      filename: d.filename,
      docType: d.docType,
    };
  });
  const aggs = aggregate(pws, { selfName: name });

  await db.transaction(async (tx) => {
    await tx.delete(personAggregates).where(eq(personAggregates.applicantId, applicantId));
    // Only the aggregation-derived flags; keep seal/handwriting/needs_vision/low_confidence.
    await tx
      .delete(reviewFlags)
      .where(and(eq(reviewFlags.applicantId, applicantId), eq(reviewFlags.flagType, 'ambiguous')));

    const seenAmbiguous = new Set<string>();
    for (const agg of aggs) {
      await tx.insert(personAggregates).values({
        applicantId,
        canonicalName: agg.canonicalName,
        nameNormalized: agg.nameNormalized,
        roles: agg.roles,
        sources: agg.sources,
        nameCandidates: agg.nameCandidates,
        affiliation: agg.affiliation ?? null,
        isSelf: agg.isSelf,
        needsHuman: agg.needsHuman,
        finalStatus: 'pending',
      });
      if (agg.nameCandidates.length > 1) {
        const key = agg.nameCandidates.map((c) => c.name).slice().sort().join('|');
        if (!seenAmbiguous.has(key)) {
          seenAmbiguous.add(key);
          await tx.insert(reviewFlags).values({
            applicantId,
            flagType: 'ambiguous',
            label: agg.nameCandidates.map((c) => c.name).join(' / '),
            status: 'open',
          });
        }
      }
    }
  });

  const rel = aggs.filter((a) => !a.isSelf).length;
  const amb = aggs.filter((a) => a.nameCandidates.length > 1);
  console.log(
    `${name} (${applicantId.slice(0, 8)}): ${rel} relations, ${amb.length} ambiguous group(s)` +
      (amb.length ? ` → ${[...new Set(amb.map((a) => a.nameCandidates.map((c) => c.name).slice().sort().join(' / ')))].join('; ')}` : ''),
  );
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: tsx scripts/reaggregate-applicant.ts <지원번호|applicantId|all>');
    process.exit(1);
  }
  const db = getDb();
  let rows;
  if (target === 'all') rows = await db.select().from(applicants);
  else
    rows = await db
      .select()
      .from(applicants)
      .where(target.includes('-') ? eq(applicants.externalId, target) : eq(applicants.id, target));
  if (rows.length === 0) {
    console.error(`no applicant matched: ${target}`);
    process.exit(1);
  }
  for (const a of rows) await reaggregate(a.id, a.name);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
