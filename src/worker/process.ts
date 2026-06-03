import { eq } from 'drizzle-orm';
import type { DB } from '@/db/client';
import {
  applicants,
  documents,
  extractedPersons,
  personAggregates,
  reviewFlags,
} from '@/db/schema';
import type { FlagType, SourceKind } from '@/lib/domain';
import { initialsForm, normalizeName } from '@/lib/names';
import { REVIEW_THRESHOLDS, computeNeedsHuman } from '@/lib/review-policy';
import type { Extractor } from '@/lib/pipeline/types';
import { runPipeline, type PipelineFile } from '@/lib/pipeline/run';

function flagForKind(sourceKind: SourceKind, confidence: number): FlagType | null {
  if (sourceKind === 'seal') return 'seal';
  if (sourceKind === 'handwritten') return 'handwriting';
  if (sourceKind === 'signature') return 'signature';
  // Only printed reaches here (non-printed already flagged above); use its category threshold.
  if (confidence < REVIEW_THRESHOLDS.printed) return 'low_confidence';
  return null;
}

/**
 * Run the pipeline for one applicant and persist results.
 * Idempotent: previous extraction for the applicant's documents is cleared first, so a job can
 * be re-run safely.
 */
export async function processApplicant(
  db: DB,
  applicantId: string,
  extractor?: Extractor,
): Promise<void> {
  const applicant = (
    await db.select().from(applicants).where(eq(applicants.id, applicantId)).limit(1)
  )[0];
  if (!applicant) throw new Error(`applicant not found: ${applicantId}`);

  const docs = await db.select().from(documents).where(eq(documents.applicantId, applicantId));

  const files: PipelineFile[] = docs.map((d) => ({
    filepath: d.filepath,
    folderCategory: d.folderCategory,
    documentId: d.id,
  }));

  const result = await runPipeline(files, { applicantName: applicant.name, extractor });

  // Replace the applicant's results atomically: a mid-run failure must not leave the roster
  // half-rebuilt. (libsql/Drizzle transaction.)
  await db.transaction(async (tx) => {
    for (const d of docs) {
      await tx.delete(extractedPersons).where(eq(extractedPersons.documentId, d.id));
    }
    await tx.delete(personAggregates).where(eq(personAggregates.applicantId, applicantId));
    await tx.delete(reviewFlags).where(eq(reviewFlags.applicantId, applicantId));

    for (const doc of result.documents) {
      await tx
        .update(documents)
        .set({
          docType: doc.docType,
          sourceFormat: doc.ingest.format,
          pageCount: doc.ingest.pageCount,
          hasTextLayer: doc.ingest.hasTextLayer,
        })
        .where(eq(documents.id, doc.documentId));

      for (const p of doc.persons) {
        const needsHuman = computeNeedsHuman(p.sourceKind, p.confidence);
        const personId = crypto.randomUUID();
        await tx.insert(extractedPersons).values({
          id: personId,
          documentId: doc.documentId,
          nameRaw: p.nameRaw,
          nameNormalized: normalizeName(p.nameRaw),
          nameInitials: initialsForm(p.nameRaw),
          role: p.role,
          affiliation: p.affiliation ?? null,
          isSelf: p.isSelf ?? false,
          sourceKind: p.sourceKind,
          sourcePage: p.sourcePage,
          regionBbox: p.regionBbox ?? null,
          ocrEngine: p.ocrEngine ?? null,
          ocrConfidence: p.ocrConfidence ?? null,
          nameCandidates: p.nameCandidates ?? null,
          verificationStatus: p.verificationStatus ?? null,
          confidence: p.confidence,
          needsHuman,
          reviewStatus: 'pending',
        });

        const flagType = flagForKind(p.sourceKind, p.confidence);
        if (flagType) {
          await tx.insert(reviewFlags).values({
            personId,
            applicantId,
            documentId: doc.documentId,
            flagType,
            status: 'open',
          });
        }
      }

      // Document needs vision/human review but produced no printed text to extract from.
      const needsVision =
        doc.ingest.format === 'image' ||
        doc.ingest.format === 'hwp' ||
        (doc.ingest.format === 'pdf' && !doc.ingest.hasTextLayer);
      if (needsVision && doc.persons.length === 0) {
        await tx.insert(reviewFlags).values({
          applicantId,
          documentId: doc.documentId,
          flagType: 'needs_vision',
          label: doc.ingest.note ?? null,
          status: 'open',
        });
      }
    }

    for (const agg of result.aggregates) {
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

      // Near-duplicate names (e.g. 이주영 vs 이조영) — surface for human disambiguation.
      if (agg.nameCandidates.length > 1) {
        await tx.insert(reviewFlags).values({
          applicantId,
          flagType: 'ambiguous',
          label: agg.nameCandidates.map((c) => c.name).join(' / '),
          status: 'open',
        });
      }
    }
  });
}
