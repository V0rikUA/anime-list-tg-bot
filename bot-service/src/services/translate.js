import crypto from 'node:crypto';

/**
 * Tiny in-memory cache to reduce translation calls / rate limits.
 * Per-process; resets on deploy/restart.
 * @type {Map<string, {value: string, expiresAt: number}>}
 */
const translateCache = new Map();

/** @param {string} text */
function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/**
 * @param {unknown} raw
 * @returns {'en'|'ru'|'uk'}
 */
export function normalizeLang(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

/** @param {string} key */
function cacheGet(key) {
  const hit = translateCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    translateCache.delete(key);
    return null;
  }
  return hit.value;
}

/**
 * @param {string} key
 * @param {string} value
 * @param {number=} ttlMs
 */
function cacheSet(key, value, ttlMs = 12 * 60 * 60 * 1000) {
  translateCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function looksCyrillic(text) {
  return /[\u0400-\u04FF]/.test(String(text || ''));
}

/**
 * Translate a short label (like an anime title) into RU/UK.
 * Falls back to the input text on failure.
 *
 * @param {string} text
 * @param {unknown} targetLang
 * @returns {Promise<string>}
 */
export async function translateShort(text, targetLang) {
  const t = String(text || '').trim();
  if (!t) return '';

  const lang = normalizeLang(targetLang);
  if (lang === 'en') return t;

  // If title is already Cyrillic, don't "re-translate" it.
  if (looksCyrillic(t) && (lang === 'ru' || lang === 'uk')) return t;

  const key = `${lang}:${sha1(t)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', lang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', t);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return t;

  const json = await res.json().catch(() => null);
  const parts = Array.isArray(json?.[0]) ? json[0] : [];
  const out = parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('');
  const translated = out || t;

  cacheSet(key, translated);
  return translated;
}

