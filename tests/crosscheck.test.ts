import { describe, expect, it } from 'vitest';
import { crossCheck } from '@/lib/pipeline/crosscheck';
import type { PersonWithSource } from '@/lib/pipeline/types';

function person(
  p: Partial<PersonWithSource> & {
    nameRaw: string;
    docType: PersonWithSource['docType'];
    sourceKind: PersonWithSource['sourceKind'];
  },
): PersonWithSource {
  return {
    role: 'committee',
    sourcePage: 1,
    confidence: 0.9,
    documentId: 'd1',
    filename: 'f',
    affiliation: null,
    ...p,
  };
}

describe('crossCheck', () => {
  it('is a NO-OP for non-thesis docTypes (hindex / journal / representative)', () => {
    const out = crossCheck([
      person({ nameRaw: '홍길동', docType: 'hindex', sourceKind: 'seal' }),
      person({ nameRaw: '김철수', docType: 'journal_article', sourceKind: 'printed' }),
      person({ nameRaw: 'John Carter', docType: 'representative_research', sourceKind: 'printed' }),
    ]);
    expect(out.every((p) => p.verificationStatus === undefined)).toBe(true);
  });

  it('confirms a thesis seal that matches a co-located printed anchor', () => {
    const out = crossCheck([
      person({ nameRaw: '이준호', docType: 'degree_thesis', sourceKind: 'printed' }),
      person({ nameRaw: '이준호', docType: 'degree_thesis', sourceKind: 'seal' }),
    ]);
    expect(out.find((p) => p.sourceKind === 'seal')?.verificationStatus).toBe('confirmed');
    // printed anchor itself is untouched
    expect(out.find((p) => p.sourceKind === 'printed')?.verificationStatus).toBeUndefined();
  });

  it('flags mismatch when the thesis seal name differs from the printed anchor', () => {
    const out = crossCheck([
      person({ nameRaw: '이준호', docType: 'degree_thesis', sourceKind: 'printed' }),
      person({ nameRaw: '박서준', docType: 'degree_thesis', sourceKind: 'seal' }),
    ]);
    expect(out.find((p) => p.sourceKind === 'seal')?.verificationStatus).toBe('mismatch');
  });
});
