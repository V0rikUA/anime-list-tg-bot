export class LruTtlCache {
  constructor({ max = 500, ttlMs = 10 * 60 * 1000 } = {}) {
    this.max = Math.max(1, Number(max) || 500);
    this.ttlMs = Math.max(1000, Number(ttlMs) || 10 * 60 * 1000);
    /** @type {Map<string, {value:any, expiresAt:number}>} */
    this.map = new Map();
  }

  get(key) {
    const k = String(key || '');
    const hit = this.map.get(k);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.map.delete(k);
      return null;
    }
    // refresh LRU
    this.map.delete(k);
    this.map.set(k, hit);
    return hit.value;
  }

  set(key, value) {
    const k = String(key || '');
    if (!k) return;
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
  }
}

