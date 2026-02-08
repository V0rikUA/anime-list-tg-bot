import { NextResponse } from 'next/server';

const BOT_URL = 'https://t.me/ani_list_bot';

function isLocalhost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.startsWith('localhost:') || h === '127.0.0.1' || h.startsWith('127.0.0.1:');
}

export function middleware(request) {
  const url = request.nextUrl;

  // Allow explicit debug mode and local development.
  if (url.searchParams.get('debug') === '1') return NextResponse.next();
  if (isLocalhost(request.headers.get('host'))) return NextResponse.next();

  const ua = String(request.headers.get('user-agent') || '').toLowerCase();
  const isTelegramWebView = ua.includes('telegram');

  if (!isTelegramWebView) {
    return NextResponse.redirect(BOT_URL, 302);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/mini/:path*']
};

