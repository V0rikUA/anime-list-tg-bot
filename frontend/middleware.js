import { NextResponse } from 'next/server';

const BOT_URL = 'https://t.me/ani_list_bot';
const COOKIE_NAME = 'miniapp_mt';

function isLocalhost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.startsWith('localhost:') || h === '127.0.0.1' || h.startsWith('127.0.0.1:');
}

export function middleware(request) {
  const url = request.nextUrl;

  // Allow explicit debug mode and local development.
  if (url.searchParams.get('debug') === '1') return NextResponse.next();
  // In dev mode we don't gate access: tunnels/preview URLs should "just work".
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  if (isLocalhost(request.headers.get('host'))) return NextResponse.next();

  const expected = String(process.env.MINIAPP_ACCESS_TOKEN || '').trim();
  const mt = String(url.searchParams.get('mt') || '').trim();
  const cookieMt = String(request.cookies.get(COOKIE_NAME)?.value || '').trim();

  // If token is not configured, don't block (safer default for misconfig).
  if (!expected) return NextResponse.next();

  const provided = mt || cookieMt;
  if (provided !== expected) {
    return NextResponse.redirect(BOT_URL, 302);
  }

  // Persist token to support in-app navigation without query params.
  const res = NextResponse.next();
  if (mt && mt === expected && cookieMt !== expected) {
    res.cookies.set(COOKIE_NAME, expected, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/'
    });
  }
  return res;
}

export const config = {
  matcher: ['/', '/title/:path*', '/mini/:path*']
};
