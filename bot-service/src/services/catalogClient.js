import { config } from '../config.js';

async function callJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
      },
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(String(body?.error || body?.detail || `catalog failed with ${res.status}`));
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function catalogSearch({ q, limit = 5, lang = null, sources = ['jikan', 'shikimori'] } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];

  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(50, Math.max(1, Number(limit))) : 5;
  const url = new URL(`${config.catalogServiceUrl}/v1/catalog/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(safeLimit));
  if (lang) url.searchParams.set('lang', String(lang).trim().toLowerCase());
  if (Array.isArray(sources) && sources.length) {
    url.searchParams.set('sources', sources.join(','));
  }

  const out = await callJson(url.toString());
  return Array.isArray(out?.items) ? out.items : [];
}

