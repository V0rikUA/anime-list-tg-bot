import { BaseJsonApi } from './baseJsonApi.js';

const SHIKIMORI_WEB = String(process.env.SHIKIMORI_BASE_URL || 'https://shikimori.me').replace(/\/+$/, '');
const SHIKIMORI_API = `${SHIKIMORI_WEB}/api`;
const SHIKIMORI_ORIGIN = new URL(SHIKIMORI_WEB).origin;

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

/**
 * "Interface" for Shikimori API client (JS runtime, JSDoc contract).
 * @typedef {Object} IShikimoriApi
 * @property {(id: number|string) => Promise<any>} getAnimeById
 * @property {(opts: {query: string, limit?: number, order?: string|null}) => Promise<any[]>} searchAnime
 * @property {(id: number|string) => Promise<any[]>} getSimilarAnimeRecommendations
 * @property {(id: number|string) => Promise<any[]>} getAnimeScreenshots
 * @property {(id: number|string) => Promise<any[]>} getAnimeExternalLinks
 * @property {(id: number|string) => Promise<any[]>} getAnimeVideos
 * @property {(id: number|string) => Promise<any[]>} getAnimeRoles
 * @property {(id: number|string) => Promise<any[]>} getAnimeTopics
 * @property {(id: number|string) => Promise<any>} getCharacterById
 */

export class ShikimoriApi extends BaseJsonApi {
  constructor() {
    super({
      baseUrl: SHIKIMORI_API,
      name: 'Shikimori',
      headers: () => {
        // Shikimori expects a stable User-Agent.
        const ua = (process.env.SHIKIMORI_USER_AGENT || '').trim() || 'anime-list-tg-bot';
        return { 'User-Agent': ua };
      }
    });
  }

  _toId(raw, label) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ${label} id`);
    return n;
  }

  async getAnimeById(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}`, null, { ttlMs: 12 * 60 * 60 * 1000 });
  }

  async searchAnime({ query, limit = 5, order = null } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const lim = Number(limit);
    const safeLimit = Number.isFinite(lim) ? Math.min(50, Math.max(1, lim)) : 5;
    return this.getJson('/animes', { search: q, limit: safeLimit, ...(order ? { order } : null) }, { ttlMs: 10 * 60 * 1000 });
  }

  async getSimilarAnimeRecommendations(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/similar`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }

  async getAnimeScreenshots(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/screenshots`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }

  async getAnimeExternalLinks(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/external_links`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }

  async getAnimeVideos(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/videos`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }

  async getAnimeRoles(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/roles`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }

  async getAnimeTopics(id) {
    const animeId = this._toId(id, 'anime');
    return this.getJson(`/animes/${animeId}/topics`, null, { ttlMs: 60 * 60 * 1000 });
  }

  async getCharacterById(id) {
    const characterId = this._toId(id, 'character');
    return this.getJson(`/characters/${characterId}`, null, { ttlMs: 24 * 60 * 60 * 1000 });
  }
}

/** @type {IShikimoriApi} */
export const shikimoriApi = new ShikimoriApi();

// Backwards-compatible function exports (so callers can keep importing named functions).
export const getAnimeById = (...args) => shikimoriApi.getAnimeById(...args);
export const searchAnime = (...args) => shikimoriApi.searchAnime(...args);
export const getSimilarAnimeRecommendations = (...args) => shikimoriApi.getSimilarAnimeRecommendations(...args);
export const getAnimeScreenshots = (...args) => shikimoriApi.getAnimeScreenshots(...args);
export const getAnimeExternalLinks = (...args) => shikimoriApi.getAnimeExternalLinks(...args);
export const getAnimeVideos = (...args) => shikimoriApi.getAnimeVideos(...args);
export const getAnimeRoles = (...args) => shikimoriApi.getAnimeRoles(...args);
export const getAnimeTopics = (...args) => shikimoriApi.getAnimeTopics(...args);
export const getCharacterById = (...args) => shikimoriApi.getCharacterById(...args);
