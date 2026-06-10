import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifyPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dummy hash so unknown usernames burn the same scrypt time as wrong passwords (no user enumeration).
const DUMMY_HASH =
  '00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return NextResponse.json({ error: '아이디와 비밀번호를 입력하세요.' }, { status: 400 });
  }

  const db = getDb();
  const user = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;
  if (!ok) {
    return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const token = await signSession(user.username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    // no `secure`: served over plain http on the internal network (:3100)
  });
  return res;
}
