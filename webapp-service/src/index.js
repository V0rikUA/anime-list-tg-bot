import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './config.js';
import { validateTelegramWebAppInitData } from './telegramAuth.js';
import { AnimeRepository } from './db.js';
import { watchEpisodes, watchProviders, watchSearch, watchSourcesForEpisode, watchVideos } from './services/watchApiClient.js';

function pickTitleByLang(item, langRaw) {
  const lang = String(langRaw || '').trim().toLowerCase();
  const en = String(item?.titleEn || item?.title_en || item?.title || '').trim();
  const ru = String(item?.titleRu || item?.title_ru || '').trim();
  const uk = String(item?.titleUk || item?.title_uk || '').trim();

  if (lang === 'ru' && ru) return ru;
  if (lang === 'uk' && uk) return uk;
  return en || ru || uk || 'Unknown title';
}

const webappSearchCache = new Map();
function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(cache, key, value, ttlMs = 10 * 60 * 1000) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function callJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(String(json?.error || json?.detail || `request failed with ${res.status}`));
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function catalogSearch({ q, limit = 50, lang = null, sources = null } = {}) {
  const url = new URL(`${config.catalogServiceUrl}/v1/catalog/search`);
  url.searchParams.set('q', String(q || '').trim());
  url.searchParams.set('limit', String(limit));
  if (lang) url.searchParams.set('lang', String(lang));
  if (sources && sources.length) url.searchParams.set('sources', sources.join(','));
  return callJson(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
    }
  });
}

async function listAdd({ telegramUserId, uid, listType } = {}) {
  const url = new URL(`${config.listServiceUrl}/v1/list/${encodeURIComponent(String(telegramUserId))}/items`);
  return callJson(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
    },
    body: { uid, listType }
  });
}

async function listProgressStart({ telegramUserId, animeUid, episode, source = null, quality = null, startedVia } = {}) {
  const url = new URL(`${config.listServiceUrl}/v1/list/${encodeURIComponent(String(telegramUserId))}/progress/start`);
  return callJson(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
    },
    body: {
      animeUid,
      episode,
      source,
      quality,
      startedVia
    }
  });
}

async function listRecentProgress({ telegramUserId, limit = 5, lang = 'en' } = {}) {
  const url = new URL(`${config.listServiceUrl}/v1/list/${encodeURIComponent(String(telegramUserId))}/progress/recent`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', String(lang || 'en'));
  return callJson(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(config.internalServiceToken ? { 'X-Internal-Service-Token': config.internalServiceToken } : null)
    }
  });
}

async function ensureAnimeInDb(repository, uid) {
  const local = await repository.getCatalogItem(uid);
  if (local) return local;
  return repository.ensureAnimeStub(uid);
}

async function indexAnimeInteraction(repository, uid, { title = null } = {}) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return null;
  return repository.indexAnimeInteraction(normalizedUid, { title });
}

async function main() {
  const repository = new AnimeRepository({
    client: config.dbClient,
    dbPath: config.dbPath,
    databaseUrl: config.databaseUrl
  });
  await repository.init();

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });

  app.get('/healthz', async (request, reply) => {
    const dbHealth = await repository.checkHealth();
    if (!dbHealth.ok) return reply.code(503).send({ ok: false, database: dbHealth });
    return { ok: true, database: dbHealth, uptimeSec: Math.floor(process.uptime()) };
  });

  // Backwards-compatible health endpoint (used by some tooling).
  app.get('/health', async (request, reply) => {
    const dbHealth = await repository.checkHealth();
    if (!dbHealth.ok) return reply.code(503).send({ ok: false, database: dbHealth });
    return { ok: true, database: dbHealth, uptimeSec: Math.floor(process.uptime()) };
  });

  function validateInitDataOrReply(request, reply) {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      reply.code(400).send({ ok: false, error: 'initData is required' });
      return null;
    }

    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: config.telegramToken,
      maxAgeSec: config.webAppAuthMaxAgeSec
    });

    if (!validation.ok) {
      reply.code(401).send(validation);
      return null;
    }
    return validation;
  }

  app.post('/api/telegram/validate-init-data', async (request, reply) => {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      return reply.code(400).send({ ok: false, error: 'initData is required' });
    }
    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: config.telegramToken,
      maxAgeSec: config.webAppAuthMaxAgeSec
    });
    if (!validation.ok) return reply.code(401).send(validation);
    return {
      ok: true,
      telegramUserId: validation.telegramUserId,
      user: validation.user,
      authDate: validation.authDate
    };
  });

  app.post('/api/webapp/dashboard', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const dashboard = await repository.getDashboard(validation.telegramUserId);
    if (!dashboard.user) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }
    let continueWatching = [];
    try {
      const progressOut = await listRecentProgress({
        telegramUserId: validation.telegramUserId,
        limit: 5,
        lang: dashboard.user?.lang || 'en'
      });
      continueWatching = Array.isArray(progressOut?.items) ? progressOut.items : [];
    } catch {
      continueWatching = [];
    }

    return { ok: true, telegramUserId: validation.telegramUserId, ...dashboard, continueWatching };
  });

  app.post('/api/webapp/invite', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    await repository.ensureUser({ id: validation.telegramUserId });
    const token = await repository.createInviteToken(validation.user || { id: validation.telegramUserId });
    if (!config.botUsername) {
      return reply.code(500).send({ ok: false, error: 'TELEGRAM_BOT_USERNAME is not set' });
    }
    const link = `https://t.me/${config.botUsername}?start=${token}`;
    return { ok: true, link };
  });

  app.post('/api/webapp/lang', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;
    const lang = String(request.body?.lang || '').trim();
    if (!lang) return reply.code(400).send({ ok: false, error: 'lang is required' });

    await repository.ensureUser({ id: validation.telegramUserId });
    const out = await repository.setUserLang(validation.telegramUserId, lang);
    if (!out.ok) return reply.code(400).send({ ok: false, error: out.reason || 'failed' });
    return { ok: true, lang: out.lang };
  });

  app.post('/api/webapp/search', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const q = String(request.body?.q || '').trim();
    const limit = Number(request.body?.limit || 5);
    const page = Number(request.body?.page || 1);
    if (!q) return reply.code(400).send({ ok: false, error: 'q is required' });

    const user = await repository.getUserByTelegramId(validation.telegramUserId);
    if (!user) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(10, Math.max(1, limit)) : 5;
    const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;

    const cacheKey = `q:${q}|lang:${user.lang || 'en'}`;
    let all = cacheGet(webappSearchCache, cacheKey);
    if (!all) {
      const out = await catalogSearch({ q, limit: 50, lang: user.lang || 'en', sources: ['jikan', 'shikimori'] });
      const results = Array.isArray(out?.items) ? out.items : [];
      all = results;
      cacheSet(webappSearchCache, cacheKey, all);
      try {
        await repository.upsertCatalog(all);
      } catch {
        // ignore
      }
    }

    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / safeLimit));
    const clampedPage = Math.min(pages, safePage);
    const offset = (clampedPage - 1) * safeLimit;
    const slice = all.slice(offset, offset + safeLimit);

    const uids = slice.map((it) => String(it?.uid || '').trim()).filter(Boolean);
    const localizedRows = uids.length ? await repository.getCatalogItemsLocalized(uids, user.lang || 'en') : [];
    const byUid = new Map(localizedRows.map((r) => [String(r.uid), r]));

    const items = slice.map((it) => {
      const row = byUid.get(String(it.uid)) || it;
      return {
        uid: it.uid,
        source: it.source,
        legacyUids: Array.isArray(it.legacyUids) ? it.legacyUids : [],
        sourceRefs: it.sourceRefs || null,
        url: it.url || null,
        score: it.score ?? null,
        episodes: it.episodes ?? null,
        status: it.status ?? null,
        imageSmall: row.imageSmall || it.imageSmall || null,
        imageLarge: row.imageLarge || it.imageLarge || null,
        titleEn: row.titleEn || it.titleEn || it.title || null,
        titleRu: row.titleRu || it.titleRu || null,
        titleUk: row.titleUk || it.titleUk || null,
        synopsisEn: row.synopsisEn || it.synopsisEn || null,
        synopsisRu: row.synopsisRu || it.synopsisRu || null,
        synopsisUk: row.synopsisUk || it.synopsisUk || null,
        title: pickTitleByLang(row, user.lang || 'en')
      };
    });

    return reply.send({ ok: true, q, page: clampedPage, pages, total, limit: safeLimit, items });
  });

  app.post('/api/webapp/list/add', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    const listType = String(request.body?.listType || '').trim().toLowerCase();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });
    if (!listType) return reply.code(400).send({ ok: false, error: 'listType is required' });
    if (!['planned', 'favorite', 'watched'].includes(listType)) {
      return reply.code(400).send({ ok: false, error: 'invalid listType' });
    }

    await repository.ensureUser({ id: validation.telegramUserId });

    const anime = await ensureAnimeInDb(repository, uid);
    if (!anime) return reply.code(404).send({ ok: false, error: 'anime not found' });

    try {
      await listAdd({ telegramUserId: validation.telegramUserId, uid, listType });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/list/remove', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    const listType = String(request.body?.listType || '').trim().toLowerCase();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });
    if (!listType) return reply.code(400).send({ ok: false, error: 'listType is required' });
    if (!['planned', 'favorite', 'watched'].includes(listType)) {
      return reply.code(400).send({ ok: false, error: 'invalid listType' });
    }

    const removed = await repository.removeFromTrackedList(validation.telegramUserId, listType, uid);
    return reply.send({ ok: true, removed });
  });

  app.post('/api/webapp/recommend/add', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    await repository.ensureUser({ id: validation.telegramUserId });
    const anime = await ensureAnimeInDb(repository, uid);
    if (!anime) return reply.code(404).send({ ok: false, error: 'anime not found' });

    await repository.addRecommendation(validation.user || { id: validation.telegramUserId }, anime);
    return reply.send({ ok: true });
  });

  // Watch endpoints (preserve behavior; still backed by watch-api).
  app.post('/api/webapp/watch/search', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    let q = String(request.body?.q || '').trim();
    const source = request.body?.source ? String(request.body.source) : '';
    const limit = Number(request.body?.limit || 5);
    const page = Number(request.body?.page || 1);

    const user = await repository.getUserByTelegramId(validation.telegramUserId);
    if (!user) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }

    if (uid) await indexAnimeInteraction(repository, uid, { title: q || null });
    let map = uid ? await repository.getWatchMap(uid) : null;

    if (!q && uid) {
      const anime = await repository.getCatalogItem(uid);
      if (!anime) return reply.code(404).send({ ok: false, error: 'anime not found' });
      q = String(anime.titleEn || anime.title || '').trim();
    }
    if (!q) return reply.code(400).send({ ok: false, error: 'q or uid is required' });

    const preferredSource = source || map?.watchSource || '';

    try {
      const safeLimit = Number.isFinite(limit) ? limit : 5;
      const safePage = Number.isFinite(page) ? page : 1;
      const out = await watchSearch({ q, source: preferredSource || null, limit: safeLimit, page: safePage });
      const items = Array.isArray(out?.items) ? out.items : [];
      const total = Number.isFinite(Number(out?.total)) ? Number(out.total) : null;

      let autoPick = null;
      if (map?.watchUrl) {
        const match = items.find((it) => String(it?.url || '').trim() === String(map.watchUrl).trim());
        if (match?.animeRef) autoPick = match;
      }
      if (!autoPick && map?.watchUrl) {
        try {
          const resolveOut = await watchSearch({ q, source: preferredSource || null, limit: 50, page: 1 });
          const resolveItems = Array.isArray(resolveOut?.items) ? resolveOut.items : [];
          const match = resolveItems.find((it) => String(it?.url || '').trim() === String(map.watchUrl).trim());
          if (match?.animeRef) autoPick = match;
        } catch {
          // ignore
        }
      }

      const isUnambiguous = total !== null ? total === 1 : items.length === 1;
      if (!map && uid && isUnambiguous && items.length === 1) {
        const only = items[0];
        const watchSource = String(only?.source || '').trim();
        const watchUrl = String(only?.url || '').trim();
        if (watchSource && watchUrl) {
          try {
            await repository.setWatchMap(uid, watchSource, watchUrl, String(only?.title || '').trim() || null);
            map = await repository.getWatchMap(uid);
            if (only?.animeRef) autoPick = only;
          } catch {
            // ignore
          }
        }
      }

      const ordered = autoPick ? [autoPick, ...items.filter((it) => it !== autoPick)] : items;
      return reply.send({
        ok: true,
        items: ordered,
        page: out?.page ?? safePage,
        limit: out?.limit ?? safeLimit,
        total: out?.total ?? null,
        pages: out?.pages ?? null,
        map: map ? { uid, watchSource: map.watchSource, watchUrl: map.watchUrl, watchTitle: map.watchTitle } : null,
        autoPick
      });
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/bind', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    const watchSource = String(request.body?.watchSource || request.body?.source || '').trim();
    const watchUrl = String(request.body?.watchUrl || request.body?.url || '').trim();
    const watchTitle = request.body?.watchTitle || request.body?.title || null;

    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });
    if (!watchSource) return reply.code(400).send({ ok: false, error: 'watchSource is required' });
    if (!watchUrl) return reply.code(400).send({ ok: false, error: 'watchUrl is required' });

    try {
      await repository.ensureUser({ id: validation.telegramUserId });
      await indexAnimeInteraction(repository, uid, { title: watchTitle || null });
      await repository.setWatchMap(uid, watchSource, watchUrl, watchTitle);
      return reply.send({ ok: true });
    } catch (err) {
      const msg = err?.message === 'anime_not_found' ? 'anime not found' : (err?.message || String(err));
      return reply.code(400).send({ ok: false, error: msg });
    }
  });

  app.post('/api/webapp/watch/unbind', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    try {
      await repository.ensureUser({ id: validation.telegramUserId });
      await repository.clearWatchMap(uid);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/providers', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    try {
      const out = await watchProviders();
      return reply.send({
        ok: true,
        sources: Array.isArray(out?.sources) ? out.sources : []
      });
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/episodes', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const animeRef = String(request.body?.animeRef || '').trim();
    if (!animeRef) return reply.code(400).send({ ok: false, error: 'animeRef is required' });
    try {
      const out = await watchEpisodes({ animeRef });
      return reply.send(out);
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/sources', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const animeRef = String(request.body?.animeRef || '').trim();
    const episodeNum = String(request.body?.episodeNum || request.body?.episode_num || '').trim();
    if (!animeRef) return reply.code(400).send({ ok: false, error: 'animeRef is required' });
    if (!episodeNum) return reply.code(400).send({ ok: false, error: 'episodeNum is required' });
    try {
      const out = await watchSourcesForEpisode({ animeRef, episodeNum });
      return reply.send(out);
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/videos', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const sourceRef = String(request.body?.sourceRef || '').trim();
    if (!sourceRef) return reply.code(400).send({ ok: false, error: 'sourceRef is required' });
    try {
      const out = await watchVideos({ sourceRef });
      return reply.send(out);
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/api/webapp/watch/progress/start', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const animeUid = String(request.body?.animeUid || request.body?.uid || '').trim();
    const episodeLabel = String(request.body?.episode?.label || request.body?.episodeLabel || '').trim();
    const episodeNumber = request.body?.episode?.number ?? request.body?.episodeNumber ?? null;
    const source = request.body?.source ?? null;
    const quality = request.body?.quality ?? null;
    const startedVia = String(request.body?.startedVia || '').trim().toLowerCase();

    if (!animeUid) return reply.code(400).send({ ok: false, error: 'animeUid is required' });
    if (!episodeLabel) return reply.code(400).send({ ok: false, error: 'episode.label is required' });
    if (!startedVia) return reply.code(400).send({ ok: false, error: 'startedVia is required' });

    try {
      await indexAnimeInteraction(repository, animeUid);
      const out = await listProgressStart({
        telegramUserId: validation.telegramUserId,
        animeUid,
        episode: {
          label: episodeLabel,
          ...(episodeNumber !== null && episodeNumber !== undefined ? { number: episodeNumber } : null)
        },
        source,
        quality,
        startedVia
      });
      return reply.send({ ok: true, ...out });
    } catch (err) {
      return reply.code(err?.status || 502).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // Debug/legacy endpoints (used by frontend in debug mode).
  app.get('/api/dashboard/:telegramUserId', async (request, reply) => {
    const telegramUserId = String(request.params?.telegramUserId || '').trim();
    if (!telegramUserId) return reply.code(400).send({ ok: false, error: 'telegramUserId is required' });
    const dashboard = await repository.getDashboard(telegramUserId);
    if (!dashboard.user) return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    return { ok: true, telegramUserId, ...dashboard };
  });

  app.get('/api/users/:telegramUserId/watch-stats/:uid', async (request, reply) => {
    const telegramUserId = String(request.params?.telegramUserId || '').trim();
    const uid = String(request.params?.uid || '').trim();
    if (!telegramUserId) return reply.code(400).send({ ok: false, error: 'telegramUserId is required' });
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });
    const stats = await repository.getWatchStats(telegramUserId, uid);
    return { ok: true, ...stats };
  });

  app.get('/api/users/:telegramUserId/friends', async (request, reply) => {
    const telegramUserId = String(request.params?.telegramUserId || '').trim();
    if (!telegramUserId) return reply.code(400).send({ ok: false, error: 'telegramUserId is required' });
    const friends = await repository.getFriends(telegramUserId);
    return { ok: true, friends };
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await repository.destroy();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
