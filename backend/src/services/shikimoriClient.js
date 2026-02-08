const SHIKIMORI_API = 'https://shikimori.one/api';
const SHIKIMORI_WEB = 'https://shikimori.one';
const SHIKIMORI_ORIGIN = new URL(SHIKIMORI_WEB).origin;

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs = 6 * 60 * 60 * 1000) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function headers() {
  // Shikimori expects a stable User-Agent.
  const ua = (process.env.SHIKIMORI_USER_AGENT || '').trim() || 'anime-list-tg-bot';
  return {
    Accept: 'application/json',
    'User-Agent': ua
  };
}

function apiUrl(pathname) {
  return `${SHIKIMORI_API}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

export function shikimoriAnimeLink(id) {
  return `${SHIKIMORI_WEB}/animes/${id}`;
}

export function shikimoriAssetUrl(pathname) {
  const p = String(pathname || '').trim();
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  if (!p.startsWith('/')) return `${SHIKIMORI_ORIGIN}/${p}`;
  return `${SHIKIMORI_ORIGIN}${p}`;
}

function withQuery(pathname, query) {
  const url = new URL(apiUrl(pathname));
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function requestJson(url, { ttlMs = 0 } = {}) {
  const key = ttlMs ? `GET:${url}` : null;
  if (key) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Shikimori request failed with ${res.status}`);
  }
  const json = await res.json().catch(() => null);
  if (key) cacheSet(key, json, ttlMs);
  return json;
}

export async function getAnimeById(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}`), { ttlMs: 12 * 60 * 60 * 1000 });
}

export async function searchAnime({ query, limit = 5, order = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.min(50, Math.max(1, lim)) : 5;

  const url = withQuery('/animes', {
    search: q,
    limit: safeLimit,
    ...(order ? { order } : null)
  });
  return requestJson(url, { ttlMs: 10 * 60 * 1000 });
}

// Extra endpoints mirrored from the Dart package API surface.
export async function getSimilarAnimeRecommendations(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/similar`), { ttlMs: 24 * 60 * 60 * 1000 });
}

export async function getAnimeScreenshots(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/screenshots`), { ttlMs: 24 * 60 * 60 * 1000 });
}

export async function getAnimeExternalLinks(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/external_links`), { ttlMs: 24 * 60 * 60 * 1000 });
}

export async function getAnimeVideos(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/videos`), { ttlMs: 24 * 60 * 60 * 1000 });
}

export async function getAnimeRoles(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/roles`), { ttlMs: 24 * 60 * 60 * 1000 });
}

export async function getAnimeTopics(id) {
  const animeId = Number(id);
  if (!Number.isFinite(animeId) || animeId <= 0) throw new Error('invalid anime id');
  return requestJson(apiUrl(`/animes/${animeId}/topics`), { ttlMs: 60 * 60 * 1000 });
}

export async function getCharacterById(id) {
  const characterId = Number(id);
  if (!Number.isFinite(characterId) || characterId <= 0) throw new Error('invalid character id');
  return requestJson(apiUrl(`/characters/${characterId}`), { ttlMs: 24 * 60 * 60 * 1000 });
}
