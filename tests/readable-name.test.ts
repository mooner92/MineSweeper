import { describe, expect, it } from 'vitest';
import { readableName } from '@/lib/data';

describe('readableName', () => {
  it('keeps composed Korean and ascii names', () => {
    expect(readableName('연구보고서.hwp')).toBe('연구보고서.hwp');
    expect(readableName('paper.pdf')).toBe('paper.pdf');
  });

  it('NFC-recomposes conjoining-jamo (NFD) names', () => {
    expect(readableName('학위논문'.normalize('NFD'))).toBe('학위논문');
  });

  it('returns null for unrecoverable decomposed names (compatibility jamo)', () => {
    // U+3147.. compatibility jamo (some mac/zip names) — NFC can't recompose; show doc-type instead.
    expect(readableName('0323_[ㅇㅕㄴㄱㅜㅂㅗㄱㅗㅅㅓ].hwp')).toBeNull();
  });

  it('returns null for empty/missing', () => {
    expect(readableName(null)).toBeNull();
    expect(readableName('')).toBeNull();
  });
});
