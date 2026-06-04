import { describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/pipeline/aggregate';
import type { PersonWithSource } from '@/lib/pipeline/types';

function person(p: Partial<PersonWithSource> & { nameRaw: string }): PersonWithSource {
  return {
    role: 'coauthor',
    sourceKind: 'printed',
    sourcePage: 1,
    confidence: 0.9,
    documentId: 'doc',
    filename: 'file',
    docType: 'journal_article',
    ...p,
  };
}

describe('aggregate', () => {
  it('merges the same person across documents and unions roles + sources', () => {
    const result = aggregate([
      person({ nameRaw: 'Galen D. Newman', role: 'supervisor', documentId: 'thesis', docType: 'degree_thesis' }),
      person({ nameRaw: 'G Newman', role: 'coauthor', documentId: 'article' }),
    ]);
    expect(result).toHaveLength(1);
    const galen = result[0];
    expect(galen.roles.sort()).toEqual(['coauthor', 'supervisor']);
    expect(galen.sources).toHaveLength(2);
    expect(galen.canonicalName).toBe('Galen D. Newman'); // prefers the most complete form
  });

  it('flags the applicant themself for auto-exclusion', () => {
    const result = aggregate(
      [person({ nameRaw: 'Seonju Jang' }), person({ nameRaw: 'Galen Newman' })],
      { selfName: 'S Jang' },
    );
    expect(result.find((r) => r.canonicalName === 'Seonju Jang')?.isSelf).toBe(true);
    expect(result.find((r) => r.canonicalName === 'Galen Newman')?.isSelf).toBe(false);
  });

  it('marks needsHuman for non-printed or low-confidence sources', () => {
    const sealed = aggregate([person({ nameRaw: '홍길동', sourceKind: 'seal', confidence: 0.95 })]);
    expect(sealed[0].needsHuman).toBe(true);

    const lowConf = aggregate([person({ nameRaw: '김철수', sourceKind: 'printed', confidence: 0.4 })]);
    expect(lowConf[0].needsHuman).toBe(true);

    const clean = aggregate([person({ nameRaw: '이영희', sourceKind: 'printed', confidence: 0.9 })]);
    expect(clean[0].needsHuman).toBe(false);
  });

  it('keeps ambiguous names separate (no over-merge)', () => {
    const result = aggregate([
      person({ nameRaw: 'Galen Newman' }),
      person({ nameRaw: 'Galen Lee' }),
      person({ nameRaw: 'Chanam Lee' }),
    ]);
    expect(result).toHaveLength(3);
  });

  it('does NOT flag distinct Latin initial names as near-duplicate candidates', () => {
    // "C Lee" / "J Lee" are edit-distance 1 but are different people, not OCR misreads.
    const result = aggregate([
      person({ nameRaw: 'C Lee' }),
      person({ nameRaw: 'J Lee' }),
      person({ nameRaw: 'HJ Lee' }),
    ]);
    for (const r of result) {
      expect(r.nameCandidates).toEqual([]);
      expect(r.needsHuman).toBe(false); // printed + high confidence + not ambiguous → auto-pass
    }
  });

  it('still flags Korean near-duplicates (OCR misread, same surname) as candidates', () => {
    const result = aggregate([person({ nameRaw: '이주영' }), person({ nameRaw: '이조영' })]);
    expect(result.every((r) => r.nameCandidates.length > 1)).toBe(true);
    expect(result.every((r) => r.needsHuman)).toBe(true);
  });

  it('does NOT flag Korean names with different surnames as candidates', () => {
    // 김종성 vs 류종성: edit-distance 1 but different 성씨 → different people, not an OCR misread.
    const result = aggregate([person({ nameRaw: '김종성' }), person({ nameRaw: '류종성' })]);
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.nameCandidates).toEqual([]);
      expect(r.needsHuman).toBe(false);
    }
  });

  it('dedupes repeated source refs from the same document/page/role', () => {
    // Same person extracted 4× from one hindex capture → one source line, not four.
    const dupes = Array.from({ length: 4 }, () =>
      person({ nameRaw: 'Hosang Kim', documentId: 'hindex', docType: 'hindex', sourcePage: 1 }),
    );
    const result = aggregate(dupes);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(1);
  });
});
