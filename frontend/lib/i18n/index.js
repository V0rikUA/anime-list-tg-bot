import { en } from './en';
import { ru } from './ru';
import { uk } from './uk';

/**
 * Supported UI languages (normalized).
 * @typedef {'en'|'ru'|'uk'} Lang
 */
export const SUPPORTED_LANGS = ['en', 'ru', 'uk'];

/**
 * Normalize raw language codes from Telegram / browser / storage.
 * Falls back to English.
 *
 * @param {unknown} raw
 * @returns {Lang}
 */
export function normalizeLang(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk') || v.startsWith('ua')) return 'uk';
  return 'en';
}

export const dictionaries = { en, ru, uk };

/**
 * @param {unknown} langRaw
 * @returns {Record<string, any>}
 */
export function getDict(langRaw) {
  const lang = normalizeLang(langRaw);
  return dictionaries[lang] || dictionaries.en;
}

/**
 * Translate a dot-separated key from the dictionary and interpolate params.
 *
 * Example: `translate('ru', 'dashboard.profileMeta', { name: 'V0rik', id: 123 })`
 *
 * @param {unknown} langRaw
 * @param {string} key
 * @param {Record<string, unknown>=} params
 * @returns {string}
 */
export function translate(langRaw, key, params) {
  const lang = normalizeLang(langRaw);
  const dict = getDict(lang);
  const fallback = dictionaries.en;

  const path = String(key || '').split('.').filter(Boolean);
  const get = (obj) => path.reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);

  const template = get(dict) ?? get(fallback) ?? key;
  if (typeof template !== 'string') {
    return String(template ?? key);
  }

  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
