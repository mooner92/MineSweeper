import { describe, expect, it } from 'vitest';
import { editDistance, fuzzyMatchWithin, namesMatch } from '@/lib/names';

describe('editDistance', () => {
  it('is 1 for a single-syllable Korean substitution (이주영 vs 이조영)', () => {
    expect(editDistance('이주영', '이조영')).toBe(1);
  });
  it('is 0 for identical names', () => {
    expect(editDistance('홍길동', '홍길동')).toBe(0);
  });
  it('works for Latin too', () => {
    expect(editDistance('John', 'Galon')).toBe(1);
  });
});

describe('fuzzyMatchWithin', () => {
  it('returns near-duplicates within maxDist, excluding self/exact', () => {
    const r = fuzzyMatchWithin('이주영', ['이조영', '김철수', '이주영']);
    expect(r.map((x) => x.name)).toEqual(['이조영']);
    expect(r[0].distance).toBe(1);
  });
  it('excludes cross-script candidates', () => {
    expect(fuzzyMatchWithin('이주영', ['Lee Juyoung'])).toEqual([]);
  });
  it('excludes candidates beyond maxDist', () => {
    expect(fuzzyMatchWithin('이주영', ['김철수'], 1)).toEqual([]);
  });
  it('does NOT weaken strict namesMatch (still keeps near-dups separate)', () => {
    expect(namesMatch('이주영', '이조영')).toBe(false);
  });
});
