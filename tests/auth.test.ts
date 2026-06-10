import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { SESSION_TTL_MS, signSession, verifySession } from '@/lib/auth-token';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-for-vitest';
});

describe('password hashing (scrypt)', () => {
  it('verifies the original password and rejects a wrong one', () => {
    const stored = hashPassword('keiaidt-example');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPassword('keiaidt-example', stored)).toBe(true);
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});

describe('session tokens (HMAC, Web Crypto)', () => {
  it('round-trips a valid session', async () => {
    const token = await signSession('admin');
    expect(await verifySession(token)).toBe('admin');
  });

  it('rejects tampered and malformed tokens', async () => {
    const token = await signSession('admin');
    const [payload, sig] = token.split('.');
    expect(await verifySession(`${payload}x.${sig}`)).toBeNull();
    expect(await verifySession(`${payload}.${sig}x`)).toBeNull();
    expect(await verifySession('garbage')).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });

  it('rejects expired sessions', async () => {
    const issuedLongAgo = Date.now() - SESSION_TTL_MS - 1000;
    const token = await signSession('admin', issuedLongAgo);
    expect(await verifySession(token)).toBeNull();
  });
});
