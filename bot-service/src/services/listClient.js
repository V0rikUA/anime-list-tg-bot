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

function encId(id) {
  return encodeURIComponent(String(id || '').trim());
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function ensureUser(telegramUser) {
  const url = `${config.listServiceUrl}/v1/users/ensure`;
  const body = {
    telegramId: String(telegramUser?.id || ''),
    username: telegramUser?.username ?? null,
    firstName: telegramUser?.first_name ?? null,
    lastName: telegramUser?.last_name ?? null,
    languageCode: telegramUser?.language_code ?? null
  };
  const out = await callJson(url, { method: 'POST', body });
  return out?.user || null;
}

export async function setUserLang(telegramId, lang) {
  const url = `${config.listServiceUrl}/v1/users/${encId(telegramId)}/lang`;
  return callJson(url, { method: 'PATCH', body: { lang } });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function upsertCatalog(items) {
  const url = `${config.listServiceUrl}/v1/catalog/upsert`;
  return callJson(url, { method: 'POST', body: { items } });
}

export async function getCatalogItemLocalized(uid, lang) {
  const u = new URL(`${config.listServiceUrl}/v1/catalog/${encId(uid)}`);
  if (lang) u.searchParams.set('lang', String(lang));
  const out = await callJson(u.toString());
  return out?.item || null;
}

export async function getWatchMap(uid) {
  const url = `${config.listServiceUrl}/v1/catalog/${encId(uid)}/watch-map`;
  const out = await callJson(url);
  return out?.watchMap || null;
}

export async function setWatchMap(uid, watchSource, watchUrl, watchTitle = null) {
  const url = `${config.listServiceUrl}/v1/catalog/${encId(uid)}/watch-map`;
  return callJson(url, {
    method: 'PUT',
    body: { watchSource, watchUrl, watchTitle }
  });
}

export async function clearWatchMap(uid) {
  const url = `${config.listServiceUrl}/v1/catalog/${encId(uid)}/watch-map`;
  return callJson(url, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Tracked Lists
// ---------------------------------------------------------------------------

export async function addToTrackedList(telegramId, listType, anime) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/tracked`;
  return callJson(url, {
    method: 'POST',
    body: { listType, anime }
  });
}

export async function removeFromTrackedList(telegramId, listType, uid) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/tracked/${encId(listType)}/${encId(uid)}`;
  const out = await callJson(url, { method: 'DELETE' });
  return out?.removed ?? false;
}

export async function getTrackedList(telegramId, listType) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/tracked/${encId(listType)}`;
  const out = await callJson(url);
  return out?.items || [];
}

export async function getWatchedWithFriendStats(telegramId) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/watched-with-stats`;
  const out = await callJson(url);
  return out?.items || [];
}

export async function getWatchStats(telegramId, animeUid) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/watch-stats/${encId(animeUid)}`;
  const out = await callJson(url);
  return {
    userWatchCount: out?.userWatchCount ?? 0,
    friendsWatchCount: out?.friendsWatchCount ?? 0
  };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export async function getFriends(telegramId) {
  const url = `${config.listServiceUrl}/v1/users/${encId(telegramId)}/friends`;
  const out = await callJson(url);
  return out?.friends || [];
}

export async function createInviteToken(telegramUser) {
  const userId = String(telegramUser?.id || '').trim();
  const url = `${config.listServiceUrl}/v1/users/${encId(userId)}/invite-token`;
  const out = await callJson(url, {
    method: 'POST',
    body: {
      username: telegramUser?.username ?? null,
      firstName: telegramUser?.first_name ?? null,
      lastName: telegramUser?.last_name ?? null,
      languageCode: telegramUser?.language_code ?? null
    }
  });
  return out?.token || null;
}

export async function addFriendByToken(telegramUser, token) {
  const userId = String(telegramUser?.id || '').trim();
  const url = `${config.listServiceUrl}/v1/users/${encId(userId)}/join`;
  return callJson(url, {
    method: 'POST',
    body: {
      token,
      username: telegramUser?.username ?? null,
      firstName: telegramUser?.first_name ?? null,
      lastName: telegramUser?.last_name ?? null
    }
  });
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export async function addRecommendation(telegramId, anime) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/recommendations`;
  return callJson(url, { method: 'POST', body: { anime } });
}

export async function removeRecommendation(telegramId, uid) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/recommendations/${encId(uid)}`;
  const out = await callJson(url, { method: 'DELETE' });
  return out?.removed ?? false;
}

export async function getOwnRecommendations(telegramId) {
  const url = `${config.listServiceUrl}/v1/list/${encId(telegramId)}/recommendations/own`;
  const out = await callJson(url);
  return out?.items || [];
}

export async function getRecommendationsFromFriends(telegramId, limit = 25) {
  const u = new URL(`${config.listServiceUrl}/v1/list/${encId(telegramId)}/recommendations/from-friends`);
  u.searchParams.set('limit', String(limit));
  const out = await callJson(u.toString());
  return out?.items || [];
}

// ---------------------------------------------------------------------------
// Watch Progress (existing)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function checkHealth() {
  try {
    const url = `${config.listServiceUrl}/healthz`;
    const out = await callJson(url, { timeoutMs: 5000 });
    return out?.ok ? { ok: true } : { ok: false, error: 'list-service unhealthy' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
