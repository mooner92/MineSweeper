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
});
