import type { NameCandidate, Role, SourceRef } from '@/lib/domain';
import { fuzzyMatchWithin, nameCompleteness, namesMatch, normalizeName } from '@/lib/names';
import { computeNeedsHuman } from '@/lib/review-policy';
import type { AggregatedPerson, PersonWithSource } from '@/lib/pipeline/types';

interface Group {
  members: PersonWithSource[];
  roles: Set<Role>;
  sources: SourceRef[];
  affiliation: string | null;
  bestName: string;
  bestScore: number;
  isSelf: boolean;
}

export interface AggregateOptions {
  /** Applicant name — matched persons are flagged is_self for auto-exclusion. */
  selfName?: string;
}

/** Collapse repeated source refs — same person extracted N times from one document/page/role
 *  (e.g. a name listed across several entries of one google-scholar capture) should show once. */
function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sources) {
    const key = `${s.documentId}|${s.page}|${s.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Stage 4 — collapse per-document occurrences into one row per real person.
 * Roles are unioned; provenance is collected; the applicant themself is flagged. Merging is
 * deliberately conservative (see names.namesMatch) so ambiguous names stay separate.
 *
 * Phase 1.5a additions:
 *  - Near-duplicate detection: within the applicant's name set, names at edit-distance ≤1 of
 *    the same script (e.g. 이주영 vs 이조영) are surfaced as `nameCandidates` for a human to
 *    disambiguate. They are NOT auto-merged, and the row is forced to needsHuman.
 *  - needsHuman is computed via the shared review-policy helper (same as worker/process.ts).
 */
export function aggregate(
  persons: PersonWithSource[],
  options: AggregateOptions = {},
): AggregatedPerson[] {
  const { selfName } = options;
  const groups: Group[] = [];

  for (const p of persons) {
    let group = groups.find((g) => g.members.some((m) => namesMatch(m.nameRaw, p.nameRaw)));
    if (!group) {
      group = {
        members: [],
        roles: new Set<Role>(),
        sources: [],
        affiliation: null,
        bestName: p.nameRaw,
        bestScore: -1,
        isSelf: false,
      };
      groups.push(group);
    }

    group.members.push(p);
    group.roles.add(p.role);
    group.sources.push({
      documentId: p.documentId,
      filename: p.filename,
      docType: p.docType,
      page: p.sourcePage,
      role: p.role,
      sourceKind: p.sourceKind,
      confidence: p.confidence,
      evidence: p.evidence,
    });
    if (!group.affiliation && p.affiliation) group.affiliation = p.affiliation;

    const score = nameCompleteness(p.nameRaw);
    if (score > group.bestScore) {
      group.bestScore = score;
      group.bestName = p.nameRaw;
    }
    if (p.isSelf) group.isSelf = true;
  }

  const canonicals = groups.map((g) => normalizeName(g.bestName));

  return groups.map((g, idx) => {
    const canonicalName = canonicals[idx];
    // Gazetteer = the applicant's other canonical names; flag near-duplicates for review.
    // Restricted to Hangul names: near-duplicate (edit-distance ≤1) is an OCR-misread signal for
    // Korean (이주영 vs 이조영). Latin initials (C Lee vs J Lee) are distinct people, not misreads,
    // so fuzzy-matching them would wrongly flag everyone as ambiguous.
    const near = /[가-힣]/.test(canonicalName)
      ? fuzzyMatchWithin(
          canonicalName,
          canonicals.filter((_, i) => i !== idx),
          1,
        ).filter((n) => n.name[0] === canonicalName[0]) // same surname only — 김종성 vs 류종성 are
      : // different people (different 성씨), not an OCR misread; 이주영 vs 이조영 (same 이) is.
        [];
    const ambiguous = near.length > 0;
    const nameCandidates: NameCandidate[] = ambiguous
      ? [
          { name: canonicalName, score: 1 },
          ...near.map((n) => ({ name: n.name, score: Math.max(0, 1 - n.distance * 0.15) })),
        ]
      : [];

    const isSelf =
      g.isSelf || (selfName ? g.members.some((m) => namesMatch(m.nameRaw, selfName)) : false);
    const needsHuman =
      ambiguous || g.members.some((m) => computeNeedsHuman(m.sourceKind, m.confidence));

    return {
      canonicalName,
      nameNormalized: canonicalName,
      roles: [...g.roles],
      sources: dedupeSources(g.sources),
      affiliation: g.affiliation,
      isSelf,
      needsHuman,
      nameCandidates,
    } satisfies AggregatedPerson;
  });
}
