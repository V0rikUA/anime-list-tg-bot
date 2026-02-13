import { config } from '../config.js';

async function callJson(url, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : null),
        ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(String(json?.error || json?.detail || `list-service failed with ${res.status}`));
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function listProgressStart({ telegramUserId, animeUid, episode, source = null, quality = null, startedVia } = {}) {
  const userId = String(telegramUserId || '').trim();
  if (!userId) return null;
  const url = new URL(`${config.listServiceUrl}/v1/list/${encodeURIComponent(userId)}/progress/start`);
  return callJson(url.toString(), {
    method: 'POST',
    body: {
      animeUid,
      episode,
      source,
      quality,
      startedVia
    }
  });
}

export async function listRecentProgress({ telegramUserId, limit = 5, lang = 'en' } = {}) {
  const userId = String(telegramUserId || '').trim();
  if (!userId) return { ok: true, items: [] };
  const url = new URL(`${config.listServiceUrl}/v1/list/${encodeURIComponent(userId)}/progress/recent`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', String(lang || 'en'));
  return callJson(url.toString(), { method: 'GET' });
}
