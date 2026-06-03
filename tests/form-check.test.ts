import { describe, expect, it } from 'vitest';
import { isPersonName } from '@/lib/form-check';

describe('isPersonName (shared form-check)', () => {
  it('accepts Korean names, rejects role/title words', () => {
    expect(isPersonName('이준호')).toBe(true);
    expect(isPersonName('교수')).toBe(false);
    expect(isPersonName('심사위원')).toBe(false);
  });
  it('accepts Latin full names, rejects affiliation/title-case phrases', () => {
    expect(isPersonName('John Carter')).toBe(true);
    expect(isPersonName('University Press')).toBe(false);
  });
});
