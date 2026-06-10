import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth-token';

/**
 * Auth gate (Phase 1, local login). Everything requires a valid session cookie except the
 * login page/endpoint and Next static assets. Applicant PII lives behind every other route
 * (pages AND /api/file, /api/export, …), so the gate sits here, before any handler runs.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  // APIs answer 401 (fetch callers); pages bounce to the login form with a return path.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals/static files entirely; everything else passes through the gate above.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
