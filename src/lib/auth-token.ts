/**
 * Session tokens — Web Crypto ONLY (no node builtins) so this module is importable from the
 * edge middleware as well as node route handlers. Password hashing lives in auth.ts (node).
 *
 * Token = b64url(JSON{u,exp}) + "." + b64url(HMAC-SHA256(payload, AUTH_SECRET)).
 * AUTH_SECRET comes from .env (gitignored — the repo is public, never commit it).
 */
export const SESSION_COOKIE = 'ms_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// crypto.subtle wants BufferSource (plain-ArrayBuffer view); newer TS types TextEncoder output
// as Uint8Array<ArrayBufferLike>, so we narrow explicitly (encode() never returns SharedArrayBuffer).
function encodeBytes(s: string): BufferSource {
  return new TextEncoder().encode(s) as BufferSource;
}

function secretBytes(): BufferSource {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set (.env)');
  return encodeBytes(secret);
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encodeBytes(payload));
  return b64url(new Uint8Array(sig));
}

/** Issue a "payload.signature" token for the given username. */
export async function signSession(username: string, now = Date.now()): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ u: username, exp: now + SESSION_TTL_MS })),
  );
  return `${payload}.${await hmac(payload)}`;
}

/** Verify a token; returns the username or null (bad signature / expired / malformed). */
export async function verifySession(
  token: string | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if ((await hmac(payload)) !== sig) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as {
      u?: string;
      exp?: number;
    };
    if (!data.u || !data.exp || data.exp < now) return null;
    return data.u;
  } catch {
    return null;
  }
}
