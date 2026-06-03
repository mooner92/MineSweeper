import type { Role, SourceRef } from '@/lib/domain';
import { nameCompleteness, namesMatch, normalizeName } from '@/lib/names';
import type { AggregatedPerson, PersonWithSource } from '@/lib/pipeline/types';

/** Below this extraction confidence, a person is routed to human review. */
const CONFIDENCE_THRESHOLD = 0.7;

interface Group {
  members: PersonWithSource[];
  roles: Set<Role>;
  sources: SourceRef[];
  affiliation: string | null;
  bestName: string;
  bestScore: number;
  isSelf: boolean;
  needsHuman: boolean;
}

export interface AggregateOptions {
  /** Applicant name — matched persons are flagged is_self for auto-exclusion. */
  selfName?: string;
  confidenceThreshold?: number;
}

/**
 * Stage 4 — collapse per-document occurrences into one row per real person.
 * Roles are unioned; provenance is collected; the applicant themself is flagged. Merging is
 * deliberately conservative (see names.namesMatch) so ambiguous names stay separate.
 */
export function aggregate(
  persons: PersonWithSource[],
  options: AggregateOptions = {},
): AggregatedPerson[] {
  const { selfName } = options;
  const threshold = options.confidenceThreshold ?? CONFIDENCE_THRESHOLD;
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
        needsHuman: false,
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
    if (p.sourceKind !== 'printed' || p.confidence < threshold) group.needsHuman = true;
  }

  return groups.map((g) => {
    const isSelf =
      g.isSelf || (selfName ? g.members.some((m) => namesMatch(m.nameRaw, selfName)) : false);
    const canonicalName = normalizeName(g.bestName);
    return {
      canonicalName,
      nameNormalized: canonicalName,
      roles: [...g.roles],
      sources: g.sources,
      affiliation: g.affiliation,
      isSelf,
      needsHuman: g.needsHuman,
    } satisfies AggregatedPerson;
  });
}
