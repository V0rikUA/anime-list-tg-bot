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
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('en')) return 'en';
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

function normalizeSourceLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'auto';
}

async function doTranslate(text, { sourceLang, targetLang }) {
  const t = String(text || '').trim();
  if (!t) return '';

  const target = normalizeLang(targetLang);
  const source = normalizeSourceLang(sourceLang);
  if (source !== 'auto' && source === target) return t;

  const key = `${source}:${target}:${sha1(t)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', source);
  url.searchParams.set('tl', target);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', t);

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return t;
    const json = await res.json().catch(() => null);
    const parts = Array.isArray(json?.[0]) ? json[0] : [];
    const out = parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('').trim();
    const translated = out || t;
    cacheSet(key, translated);
    return translated;
  } catch {
    return t;
  }
}

/**
 * Translate with explicit source and target language.
 *
 * @param {string} text
 * @param {{from: 'en'|'ru'|'uk', to: 'en'|'ru'|'uk'}} options
 * @returns {Promise<string>}
 */
export async function translateText(text, { from, to }) {
  return doTranslate(text, { sourceLang: from, targetLang: to });
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
  const lang = normalizeLang(targetLang);
  return doTranslate(text, { sourceLang: 'auto', targetLang: lang });
}
