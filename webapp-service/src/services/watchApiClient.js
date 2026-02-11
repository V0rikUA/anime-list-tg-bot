import { config } from '../config.js';

function parseAllowlist(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const items = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

export const watchAllowlist = parseAllowlist(config.watchSourcesAllowlist);

function isAllowedSource(source) {
  if (!watchAllowlist) return true;
  return watchAllowlist.has(String(source || '').toLowerCase());
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.detail || json?.error || `watch-api failed with ${res.status}`;
      const err = new Error(String(msg));
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function requireWatchApiUrl() {
  const base = String(config.watchApiUrl || '').trim();
  if (!base) {
    const err = new Error('WATCH_API_URL is not set');
    err.status = 500;
    throw err;
  }
  return base.replace(/\/+$/, '');
}

export async function watchSearch({ q, source, limit = 5, page = 1 }) {
  const base = requireWatchApiUrl();
  if (source && !isAllowedSource(source)) {
    const err = new Error('source not allowed');
    err.status = 400;
    throw err;
  }

  const url = new URL(`${base}/v1/search`);
  url.searchParams.set('q', String(q || '').trim());
  if (source) url.searchParams.set('source', String(source));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  return fetchJson(url.toString(), { timeoutMs: 15000 });
}

export async function watchEpisodes({ animeRef }) {
  const base = requireWatchApiUrl();
  const url = new URL(`${base}/v1/episodes`);
  url.searchParams.set('animeRef', String(animeRef || '').trim());
  return fetchJson(url.toString(), { timeoutMs: 15000 });
}

export async function watchSourcesForEpisode({ animeRef, episodeNum }) {
  const base = requireWatchApiUrl();
  const url = new URL(`${base}/v1/sources-for-episode`);
  url.searchParams.set('animeRef', String(animeRef || '').trim());
  url.searchParams.set('episode_num', String(episodeNum || '').trim());
  return fetchJson(url.toString(), { timeoutMs: 15000 });
}

export async function watchVideos({ sourceRef }) {
  const base = requireWatchApiUrl();
  const url = new URL(`${base}/v1/videos`);
  url.searchParams.set('sourceRef', String(sourceRef || '').trim());
  return fetchJson(url.toString(), { timeoutMs: 15000 });
}

export async function watchProviders() {
  const base = requireWatchApiUrl();
  const url = new URL(`${base}/v1/sources`);
  const out = await fetchJson(url.toString(), { timeoutMs: 10000 });

  const raw = Array.isArray(out?.sources) ? out.sources : [];
  const normalized = raw
    .map((it) => ({
      name: String(it?.name || '').trim().toLowerCase(),
      note: String(it?.note || '').trim()
    }))
    .filter((it) => Boolean(it.name));

  if (!watchAllowlist) {
    return { ok: true, sources: normalized };
  }

  const byName = new Map(normalized.map((it) => [it.name, it]));
  const filtered = [];
  for (const name of watchAllowlist) {
    const hit = byName.get(name);
    filtered.push(hit || { name, note: '' });
  }
  return { ok: true, sources: filtered };
}
