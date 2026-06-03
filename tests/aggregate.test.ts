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
});
