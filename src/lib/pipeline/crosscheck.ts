import type { VerificationStatus } from '@/lib/domain';
import { namesMatch } from '@/lib/names';
import type { PersonWithSource } from '@/lib/pipeline/types';

/**
 * Stage between Extract and Aggregate (run per document).
 *
 * For a degree-thesis approval page, a printed committee name is the ANCHOR; a co-located
 * seal/signature name is cross-checked against it → verificationStatus
 * (confirmed / mismatch / unverifiable). This is ADVISORY metadata only — by design it never
 * lowers needsHuman (see review-policy.computeNeedsHuman); non-printed sources always stay in
 * the human queue.
 *
 * Phase 1.5a note: no seal/signature NAMES are produced yet (no OCR / no crop path), so in
 * practice this is a NO-OP — the seam exists for Phase 1.5b. For every non-degree_thesis
 * docType it is always a NO-OP (no co-located printed anchor + seal).
 */
export function crossCheck(persons: PersonWithSource[]): PersonWithSource[] {
  return persons.map((p) => {
    if (p.docType !== 'degree_thesis') return p; // NO-OP: only thesis pages co-locate anchor + seal
    if (p.sourceKind === 'printed') return p; // printed is the anchor, not a cross-check target

    const anchor = persons.find(
      (q) =>
        q !== p &&
        q.documentId === p.documentId &&
        q.sourceKind === 'printed' &&
        namesMatch(q.nameRaw, p.nameRaw),
    );
    const hasAnyAnchor = persons.some(
      (q) => q.documentId === p.documentId && q.sourceKind === 'printed',
    );
    const verificationStatus: VerificationStatus = anchor
      ? 'confirmed'
      : hasAnyAnchor
        ? 'mismatch'
        : 'unverifiable';
    return { ...p, verificationStatus };
  });
}
