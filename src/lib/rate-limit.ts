/**
 * Tiny in-memory login throttle (single PM2 process — no shared store needed).
 * Policy: 5 failed attempts within 15 minutes blocks the key (client IP) for 1 hour.
 * State is per-process; a web restart clears it (acceptable for an internal tool).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const BLOCK_MS = 60 * 60 * 1000;

interface Entry {
  fails: number;
  windowStart: number;
  blockedUntil: number;
}

const entries = new Map<string, Entry>();

function prune(now: number): void {
  // Bounded by distinct IPs on an internal LAN; sweep opportunistically.
  for (const [k, e] of entries) {
    if (e.blockedUntil < now && now - e.windowStart > WINDOW_MS) entries.delete(k);
  }
}

/** Is this key currently allowed to attempt a login? */
export function checkLoginAllowed(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  prune(now);
  const e = entries.get(key);
  if (e && e.blockedUntil > now) return { allowed: false, retryAfterMs: e.blockedUntil - now };
  return { allowed: true, retryAfterMs: 0 };
}

/** Record a failed attempt; starts the 1h block once the window fills up. */
export function recordLoginFailure(key: string, now = Date.now()): void {
  const e = entries.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) {
    entries.set(key, { fails: 1, windowStart: now, blockedUntil: 0 });
    return;
  }
  e.fails += 1;
  if (e.fails >= MAX_FAILS) e.blockedUntil = now + BLOCK_MS;
}

/** A successful login clears the key's history. */
export function recordLoginSuccess(key: string): void {
  entries.delete(key);
}

/** Test hook — reset all state. */
export function resetRateLimit(): void {
  entries.clear();
}
