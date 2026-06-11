import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetRateLimit,
} from '@/lib/rate-limit';

const T0 = 1_000_000_000_000; // fixed base time
const MIN = 60 * 1000;

beforeEach(() => resetRateLimit());

describe('login rate limit', () => {
  it('allows attempts below the threshold', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('ip1', T0 + i * 1000);
    expect(checkLoginAllowed('ip1', T0 + 5000).allowed).toBe(true);
  });

  it('blocks after 5 failures within the window, for about an hour', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('ip1', T0 + i * 1000);
    const blocked = checkLoginAllowed('ip1', T0 + 6000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(50 * MIN);
    // …and unblocks after the hour passes.
    expect(checkLoginAllowed('ip1', T0 + 61 * MIN).allowed).toBe(true);
  });

  it('failures spread beyond the 15-minute window do not accumulate', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('ip1', T0 + i * 16 * MIN);
    expect(checkLoginAllowed('ip1', T0 + 5 * 16 * MIN).allowed).toBe(true);
  });

  it('a successful login clears the history', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('ip1', T0 + i * 1000);
    recordLoginSuccess('ip1');
    recordLoginFailure('ip1', T0 + 5000);
    expect(checkLoginAllowed('ip1', T0 + 6000).allowed).toBe(true);
  });

  it('keys are independent (per-IP)', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('ip1', T0 + i * 1000);
    expect(checkLoginAllowed('ip2', T0 + 6000).allowed).toBe(true);
  });
});
