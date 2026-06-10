import type { NameCandidate, Role, SourceRef } from '@/lib/domain';
import { koreanNearDuplicates, nameCompleteness, namesMatch, normalizeName } from '@/lib/names';
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
    // Flag the applicant's other canonical names that are near-duplicates of this one. Matching is
    // 자모(jamo)-level for Korean so 이주영/이조영 (1 자모 = OCR misread) flag but 김진영/김진석
    // (3 자모 = different people) do not; whole-음절 prefixes (김용/김용표) flag as 약어. Latin
    // initials (C Lee vs J Lee) are distinct people, never misreads, so they yield no candidates.
    const near = koreanNearDuplicates(
      canonicalName,
      canonicals.filter((_, i) => i !== idx),
    );
    const ambiguous = near.length > 0;
    const nameCandidates: NameCandidate[] = ambiguous
      ? [
          { name: canonicalName, score: 1 },
          ...near.map((n) => ({ name: n.name, score: n.kind === 'abbrev' ? 0.7 : 0.85 })),
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
