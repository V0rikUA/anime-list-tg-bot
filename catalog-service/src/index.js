import Fastify from 'fastify';
import { LruTtlCache } from './cache.js';
import { searchAnimeMultiSource } from './animeSources/animeSources.js';
import { rankCatalogResults } from './ranking.js';
import { requireInternalToken } from './auth/internalToken.js';

function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function parseCsv(raw) {
  const v = String(raw || '').trim();
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const app = Fastify({ logger: { level: 'info' } });
  const port = envInt('PORT', 8080);

  const cache = new LruTtlCache({
    max: envInt('CATALOG_CACHE_MAX', 500),
    ttlMs: envInt('CATALOG_CACHE_TTL_MS', 10 * 60 * 1000)
  });

  app.get('/healthz', async () => {
    return { ok: true, uptimeSec: Math.floor(process.uptime()) };
  });

  app.get('/v1/catalog/search', { preHandler: requireInternalToken }, async (request, reply) => {
    const q = String(request.query?.q || '').trim();
    if (!q) return reply.code(400).send({ ok: false, error: 'q is required' });

    const limitRaw = Number(request.query?.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 10;

    const lang = String(request.query?.lang || '').trim().toLowerCase();
    const sources = parseCsv(request.query?.sources || '') || null;
    const srcs = sources && sources.length ? sources : ['jikan', 'shikimori'];

    const cacheKey = `q:${q}|limit:${limit}|lang:${lang || 'na'}|src:${srcs.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const items = await searchAnimeMultiSource({ query: q, limit, sources: srcs });
    const ranked = rankCatalogResults(q, items);

    const out = {
      ok: true,
      q,
      limit,
      lang: lang || null,
      sources: srcs,
      items: ranked
    };

    cache.set(cacheKey, out);
    return out;
  });

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

