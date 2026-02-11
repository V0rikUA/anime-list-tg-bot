import crypto from 'node:crypto';

const translateCache = new Map();

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function normalizeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  if (v.startsWith('en')) return 'en';
  return '';
}

function cacheGet(key) {
  const hit = translateCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    translateCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs = 12 * 60 * 60 * 1000) {
  translateCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Translate text with explicit source/target language.
 * Falls back to input text on any failure.
 *
 * @param {string} text
 * @param {{from: 'ru'|'en'|'uk', to: 'ru'|'en'|'uk'}} options
 * @returns {Promise<string>}
 */
export async function translateText(text, { from, to }) {
  const input = String(text || '').trim();
  if (!input) return '';

  const source = normalizeLang(from);
  const target = normalizeLang(to);
  if (!source || !target || source === target) return input;

  const key = `${source}:${target}:${sha1(input)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', source);
  url.searchParams.set('tl', target);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', input);

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return input;
    const json = await res.json().catch(() => null);
    const parts = Array.isArray(json?.[0]) ? json[0] : [];
    const out = parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('').trim();
    const translated = out || input;
    cacheSet(key, translated);
    return translated;
  } catch {
    return input;
  }
}

