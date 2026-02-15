/**
 * Minimal JSON-over-HTTP base client with in-memory TTL cache.
 * This is intentionally small and dependency-free.
 */
export class BaseJsonApi {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl
   * @param {string=} opts.name
   * @param {() => Record<string,string>=} opts.headers
   */
  constructor({ baseUrl, name = 'api', headers = null }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.name = name;
    this._headersFn = typeof headers === 'function' ? headers : null;
    /** @type {Map<string, {value: any, expiresAt: number}>} */
    this._cache = new Map();
  }

  _cacheGet(key) {
    const hit = this._cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this._cache.delete(key);
      return null;
    }
    return hit.value;
  }

  _cacheSet(key, value, ttlMs) {
    this._cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  _headers() {
    const base = { Accept: 'application/json' };
    if (!this._headersFn) return base;
    try {
      return { ...base, ...this._headersFn() };
    } catch {
      return base;
    }
  }

  _url(pathname, query) {
    const url = new URL(`${this.baseUrl}${String(pathname || '').startsWith('/') ? '' : '/'}${pathname}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  /**
   * @param {string} pathname
   * @param {Record<string, any>=} query
   * @param {Object=} opts
   * @param {number=} opts.ttlMs
   */
  async getJson(pathname, query = null, { ttlMs = 0, timeoutMs = 8000 } = {}) {
    const url = this._url(pathname, query);
    const key = ttlMs ? `GET:${url}` : null;
    if (key) {
      const cached = this._cacheGet(key);
      if (cached) return cached;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { headers: this._headers(), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`${this.name} request failed with ${res.status}`);
    }
    const json = await res.json().catch(() => null);
    if (key) this._cacheSet(key, json, ttlMs);
    return json;
  }
}

