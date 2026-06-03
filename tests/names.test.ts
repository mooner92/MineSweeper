import { describe, expect, it } from 'vitest';
import {
  detectScript,
  initialsForm,
  nameCompleteness,
  nameKey,
  namesMatch,
  normalizeName,
} from '@/lib/names';

describe('normalizeName', () => {
  it('collapses Korean inter-syllable spacing (자간 정규화)', () => {
    expect(normalizeName('정 주 철')).toBe('정주철');
    expect(normalizeName('정  주  철')).toBe('정주철');
  });
  it('does NOT over-join surname + given Korean name', () => {
    expect(normalizeName('김 철수')).toBe('김 철수');
  });
  it('collapses extra whitespace in Latin names', () => {
    expect(normalizeName('  Galen   D.  Newman ')).toBe('Galen D. Newman');
  });
  it('strips seal/signature markers', () => {
    expect(normalizeName('정주철 (인)')).toBe('정주철');
  });
});

describe('detectScript', () => {
  it('classifies scripts', () => {
    expect(detectScript('정주철')).toBe('korean');
    expect(detectScript('Galen Newman')).toBe('latin');
    expect(detectScript('鄭周哲')).toBe('han');
    expect(detectScript('Galen 정')).toBe('mixed');
  });
});

describe('namesMatch (confident merges only)', () => {
  it('merges a full Latin name with its initial form (same surname)', () => {
    expect(namesMatch('Galen D. Newman', 'G Newman')).toBe(true);
    expect(namesMatch('Seonju Jang', 'S Jang')).toBe(true);
    expect(namesMatch('CK Kim', 'Chang Kim')).toBe(true);
  });
  it('matches Korean exact normalized', () => {
    expect(namesMatch('정 주 철', '정주철')).toBe(true);
  });
  it('does NOT merge different surnames', () => {
    expect(namesMatch('Galen Newman', 'Galen Lee')).toBe(false);
  });
  it('does NOT merge two distinct full given names sharing surname + first initial', () => {
    expect(namesMatch('Galen Newman', 'Gary Newman')).toBe(false);
    expect(namesMatch('Galen D. Newman', 'Gregory Newman')).toBe(false);
  });
  it('still merges a full name with its own initial form', () => {
    expect(namesMatch('Galen Newman', 'G. Newman')).toBe(true);
  });
  it('does NOT merge same surname but different first initial', () => {
    expect(namesMatch('S Jang', 'G Jang')).toBe(false);
  });
  it('does NOT merge across scripts', () => {
    expect(namesMatch('정주철', 'Jucheol Jung')).toBe(false);
  });
  it('does NOT merge bare initials lacking a surname', () => {
    expect(namesMatch('G N', 'Galen Newman')).toBe(false);
  });
});

describe('initialsForm + nameKey + nameCompleteness', () => {
  it('derives a short initials form', () => {
    expect(initialsForm('Galen D. Newman')).toBe('G Newman');
  });
  it('keys full and initial forms identically', () => {
    expect(nameKey('Galen D. Newman')).toBe(nameKey('G Newman'));
  });
  it('ranks a full name above an initial form', () => {
    expect(nameCompleteness('Galen Newman')).toBeGreaterThan(nameCompleteness('G Newman'));
  });
});
