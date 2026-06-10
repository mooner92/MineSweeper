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
    expect(normalizeName('이 준 호')).toBe('이준호');
    expect(normalizeName('이  준  호')).toBe('이준호');
  });
  it('does NOT over-join surname + given Korean name', () => {
    expect(normalizeName('김 철수')).toBe('김 철수');
  });
  it('collapses extra whitespace in Latin names', () => {
    expect(normalizeName('  John   D.  Carter ')).toBe('John D. Carter');
  });
  it('strips seal/signature markers', () => {
    expect(normalizeName('이준호 (인)')).toBe('이준호');
  });
});

describe('detectScript', () => {
  it('classifies scripts', () => {
    expect(detectScript('이준호')).toBe('korean');
    expect(detectScript('John Carter')).toBe('latin');
    expect(detectScript('鄭周哲')).toBe('han');
    expect(detectScript('John 정')).toBe('mixed');
  });
});

describe('namesMatch (confident merges only)', () => {
  it('merges a full Latin name with its initial form (same surname)', () => {
    expect(namesMatch('John D. Carter', 'J Carter')).toBe(true);
    expect(namesMatch('Gildong Hong', 'G Hong')).toBe(true);
    expect(namesMatch('CK Kim', 'Chang Kim')).toBe(true);
  });
  it('matches Korean exact normalized', () => {
    expect(namesMatch('이 준 호', '이준호')).toBe(true);
  });
  it('does NOT merge different surnames', () => {
    expect(namesMatch('John Carter', 'John Lee')).toBe(false);
  });
  it('does NOT merge two distinct full given names sharing surname + first initial', () => {
    expect(namesMatch('John Carter', 'Gary Carter')).toBe(false);
    expect(namesMatch('John D. Carter', 'Gregory Carter')).toBe(false);
  });
  it('still merges a full name with its own initial form', () => {
    expect(namesMatch('John Carter', 'J. Carter')).toBe(true);
  });
  it('does NOT merge same surname but different first initial', () => {
    expect(namesMatch('S Hong', 'G Hong')).toBe(false);
  });
  it('does NOT merge across scripts', () => {
    expect(namesMatch('이준호', 'Junho Lee')).toBe(false);
  });
  it('does NOT merge bare initials lacking a surname', () => {
    expect(namesMatch('J C', 'John Carter')).toBe(false);
  });
});

describe('initialsForm + nameKey + nameCompleteness', () => {
  it('derives a short initials form', () => {
    expect(initialsForm('John D. Carter')).toBe('J Carter');
  });
  it('keys full and initial forms identically', () => {
    expect(nameKey('John D. Carter')).toBe(nameKey('J Carter'));
  });
  it('ranks a full name above an initial form', () => {
    expect(nameCompleteness('John Carter')).toBeGreaterThan(nameCompleteness('J Carter'));
  });
});
