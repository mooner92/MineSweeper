import { describe, expect, it } from 'vitest';
import { REVIEW_THRESHOLDS, computeNeedsHuman } from '@/lib/review-policy';

describe('computeNeedsHuman (confirmed-is-advisory invariant)', () => {
  it('non-printed sources ALWAYS need human, regardless of confidence', () => {
    expect(computeNeedsHuman('seal', 0.99)).toBe(true);
    expect(computeNeedsHuman('handwritten', 1.0)).toBe(true);
    expect(computeNeedsHuman('signature', 0.95)).toBe(true);
  });
  it('printed auto-passes at/above its threshold', () => {
    expect(computeNeedsHuman('printed', 0.9)).toBe(false);
    expect(computeNeedsHuman('printed', REVIEW_THRESHOLDS.printed)).toBe(false);
  });
  it('printed below threshold needs human', () => {
    expect(computeNeedsHuman('printed', 0.5)).toBe(true);
  });
  it('ambiguous always needs human even for high-confidence printed', () => {
    expect(computeNeedsHuman('printed', 0.99, { ambiguous: true })).toBe(true);
  });

  it('hindex (구글스칼라 캡처) ALWAYS needs human — 약어형 이미지 OCR, self-confidence 신뢰불가', () => {
    // 모델이 source_kind=printed, confidence=1.0 으로 줘도 자동통과 금지.
    expect(computeNeedsHuman('printed', 1.0, { docType: 'hindex' })).toBe(true);
  });

  it('other doc types still auto-pass clean printed text (회귀 방지)', () => {
    expect(computeNeedsHuman('printed', 0.9, { docType: 'journal_article' })).toBe(false);
    expect(computeNeedsHuman('printed', 0.9, { docType: 'research_project' })).toBe(false);
  });
});
