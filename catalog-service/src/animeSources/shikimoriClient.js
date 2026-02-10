import { BaseJsonApi } from './baseJsonApi.js';

const SHIKIMORI_API = 'https://shikimori.one/api';
const SHIKIMORI_WEB = 'https://shikimori.one';
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

export class ShikimoriApi extends BaseJsonApi {
  constructor() {
    super({
      baseUrl: SHIKIMORI_API,
      name: 'Shikimori',
      headers: () => {
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
    return this.getJson(
      '/animes',
      { search: q, limit: safeLimit, ...(order ? { order } : null) },
      { ttlMs: 10 * 60 * 1000 }
    );
  }
}

export const shikimoriApi = new ShikimoriApi();
export const searchAnime = (...args) => shikimoriApi.searchAnime(...args);

