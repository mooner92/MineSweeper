import { describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/pipeline/aggregate';
import type { PersonWithSource } from '@/lib/pipeline/types';

function person(p: Partial<PersonWithSource> & { nameRaw: string }): PersonWithSource {
  return {
    role: 'coauthor',
    sourceKind: 'printed',
    sourcePage: 1,
    confidence: 0.9,
    documentId: 'd',
    filename: 'f',
    docType: 'journal_article',
    ...p,
  };
}

describe('aggregate — near-duplicate name candidates', () => {
  it('keeps 이주영/이조영 separate, surfaces candidates, forces needsHuman', () => {
    const r = aggregate([person({ nameRaw: '이주영' }), person({ nameRaw: '이조영' })]);
    expect(r).toHaveLength(2); // NOT auto-merged

    const a = r.find((x) => x.canonicalName === '이주영');
    const b = r.find((x) => x.canonicalName === '이조영');
    expect(a?.nameCandidates.length).toBeGreaterThan(1);
    expect(b?.nameCandidates.length).toBeGreaterThan(1);
    expect(a?.nameCandidates.map((c) => c.name)).toContain('이조영');
    expect(a?.needsHuman).toBe(true);
    expect(b?.needsHuman).toBe(true);
  });

  it('distinct names get no candidates; clean printed auto-passes', () => {
    const r = aggregate([person({ nameRaw: '홍길동' }), person({ nameRaw: '김철수' })]);
    expect(r.every((x) => x.nameCandidates.length === 0)).toBe(true);
    expect(r.every((x) => x.needsHuman === false)).toBe(true);
  });
});
