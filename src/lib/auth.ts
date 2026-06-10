/**
 * Local authentication (Phase 1) — no external IdP, zero new dependencies.
 * Passwords: node scrypt, stored as "saltHex:hashHex" in the users table.
 * Session tokens live in auth-token.ts (Web Crypto, edge-safe); re-exported here for node callers.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './auth-token';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
