import type { SourceKind } from '@/lib/domain';

/**
 * Single source of truth for "does this person need human review?".
 *
 * Invariants (Phase 1.5a):
 *  - Non-printed sources (handwritten/seal/signature) ALWAYS need human review. No score and no
 *    verificationStatus can lower this — verificationStatus is advisory metadata only.
 *  - Ambiguous (near-duplicate name candidates) always need human review.
 *  - printed auto-passes only at/above its category threshold.
 *
 * This is called by BOTH needsHuman compute sites (aggregate.ts and worker/process.ts) so the
 * rule cannot silently diverge.
 */
export const REVIEW_THRESHOLDS: Record<SourceKind, number> = {
  // printed is the only source that can auto-pass. Set at 0.75 so clean printed-text extractions
  // (the VLM reports ~0.8–0.95 for these) are triaged as auto-pass; genuinely low-confidence
  // reads still fall to human review. (Human confirms the whole roster regardless.)
  printed: 0.75,
  // Non-printed kinds set above 1.0 so confidence can never satisfy the threshold — they always
  // require human review. (The short-circuit below enforces this regardless.)
  handwritten: 1.01,
  seal: 1.01,
  signature: 1.01,
};

interface NeedsHumanOptions {
  /** True when near-duplicate name candidates exist (e.g. 이주영 vs 이조영). */
  ambiguous?: boolean;
}

export function computeNeedsHuman(
  sourceKind: SourceKind,
  confidence: number,
  options: NeedsHumanOptions = {},
): boolean {
  if (options.ambiguous) return true;
  if (sourceKind !== 'printed') return true;
  return confidence < REVIEW_THRESHOLDS.printed;
}
