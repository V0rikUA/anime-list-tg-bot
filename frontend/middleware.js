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

  // Telegram often appends tgWebApp* params when opening Web Apps. This is more reliable than UA alone.
  const hasTgParams =
    url.searchParams.has('tgWebAppPlatform') ||
    url.searchParams.has('tgWebAppVersion') ||
    url.searchParams.has('tgWebAppThemeParams') ||
    url.searchParams.has('tgWebAppStartParam') ||
    url.searchParams.has('tgWebAppBotInline') ||
    url.searchParams.has('startapp');

  const ua = String(request.headers.get('user-agent') || '').toLowerCase();
  const isTelegramWebView = ua.includes('telegram') || ua.includes('tg');

  if (!hasTgParams && !isTelegramWebView) {
    return NextResponse.redirect(BOT_URL, 302);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/mini/:path*']
};
