import { config } from '../config.js';

export function buildInviteLink(token) {
  if (!config.botUsername) {
    return null;
  }
  return `https://t.me/${config.botUsername}?start=${token}`;
}

export function buildMiniAppUrl(telegramUserId) {
  const url = new URL(config.webAppUrl);
  // Mini App no longer trusts uid for auth; this is only a debug fallback.
  if (!url.searchParams.has('uid')) {
    url.searchParams.set('uid', String(telegramUserId));
  }
  if (config.miniAppAccessToken && !url.searchParams.has('mt')) {
    url.searchParams.set('mt', String(config.miniAppAccessToken));
  }
  return url.toString();
}

export function isHttpsUrl(urlRaw) {
  try {
    const url = new URL(String(urlRaw || ''));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
