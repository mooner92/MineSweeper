import { describe, expect, it } from 'vitest';
import { jamoEditDistance, koreanNearDuplicates, namesMatch } from '@/lib/names';

describe('jamoEditDistance', () => {
  it('is 1 for a single-jamo misread (이주영 vs 이조영: ㅜ↔ㅗ)', () => {
    expect(jamoEditDistance('이주영', '이조영')).toBe(1);
  });
  it('is 3 for two unrelated syllables (김진영 vs 김진석: 영 vs 석)', () => {
    // The whole point: syllable-level distance was 1 (and wrongly flagged); jamo-level is 3.
    expect(jamoEditDistance('김진영', '김진석')).toBe(3);
  });
  it('is 0 for identical names', () => {
    expect(jamoEditDistance('홍길동', '홍길동')).toBe(0);
  });
});

describe('koreanNearDuplicates', () => {
  it('flags a single-jamo misread, same surname (이주영 → 이조영)', () => {
    const r = koreanNearDuplicates('이주영', ['이조영', '김철수', '이주영']);
    expect(r.map((x) => x.name)).toEqual(['이조영']);
    expect(r[0].kind).toBe('misread');
  });

  it('does NOT flag clearly different given names (김진영 vs 김진석)', () => {
    expect(koreanNearDuplicates('김진영', ['김진석'])).toEqual([]);
    expect(koreanNearDuplicates('김민수', ['김민호'])).toEqual([]); // 2 자모 apart → distinct
  });

  it('flags a whole-syllable prefix as an abbreviation (김용 → 김용표)', () => {
    const r = koreanNearDuplicates('김용', ['김용표']);
    expect(r.map((x) => x.name)).toEqual(['김용표']);
    expect(r[0].kind).toBe('abbrev');
  });

  it('does NOT flag a different surname (김종성 vs 류종성) or non-Hangul (Lee names)', () => {
    expect(koreanNearDuplicates('김종성', ['류종성'])).toEqual([]);
    expect(koreanNearDuplicates('이주영', ['Lee Juyoung'])).toEqual([]);
    expect(koreanNearDuplicates('C Lee', ['J Lee'])).toEqual([]);
  });

  it('does not weaken strict namesMatch (near-dups stay separate people)', () => {
    expect(namesMatch('이주영', '이조영')).toBe(false);
  });
});
