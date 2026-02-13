import Fastify from 'fastify';
import { buildDb, runMigrations } from './db/knex.js';
import { ListRepository } from './repository.js';
import { requireInternalToken } from './auth/internalToken.js';

function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

async function main() {
  const app = Fastify({ logger: { level: 'info' } });
  const port = envInt('PORT', 8080);

  const db = buildDb();
  await runMigrations(db);
  const repo = new ListRepository(db);

  app.get('/healthz', async (request, reply) => {
    const dbHealth = await repo.checkHealth();
    if (!dbHealth.ok) return reply.code(503).send({ ok: false, database: dbHealth });
    return { ok: true, database: dbHealth, uptimeSec: Math.floor(process.uptime()) };
  });

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  app.post('/v1/users/ensure', { preHandler: requireInternalToken }, async (request, reply) => {
    try {
      const user = await repo.ensureUser(request.body || {});
      return {
        ok: true,
        user: {
          telegramId: user.telegram_id,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          lang: user.lang || null
        }
      };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.patch('/v1/users/:userId/lang', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const lang = String(request.body?.lang || '').trim();
    if (!lang) return reply.code(400).send({ ok: false, error: 'lang is required' });

    const out = await repo.setUserLang(userId, lang);
    if (!out.ok) return reply.code(404).send(out);
    return out;
  });

  app.get('/v1/users/:userId/friends', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    try {
      const friends = await repo.getFriends(userId);
      return { ok: true, friends };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/v1/users/:userId/invite-token', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    try {
      const telegramUser = {
        telegramId: userId,
        username: request.body?.username ?? null,
        firstName: request.body?.firstName ?? null,
        lastName: request.body?.lastName ?? null,
        languageCode: request.body?.languageCode ?? null
      };
      const token = await repo.createInviteToken(telegramUser);
      return { ok: true, token };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/v1/users/:userId/join', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const token = String(request.body?.token || '').trim();
    if (!token) return reply.code(400).send({ ok: false, error: 'token is required' });

    try {
      const joinerData = {
        telegramId: userId,
        username: request.body?.username ?? null,
        firstName: request.body?.firstName ?? null,
        lastName: request.body?.lastName ?? null
      };
      const result = await repo.addFriendByToken(joinerData, token);
      return result;
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  app.post('/v1/catalog/upsert', { preHandler: requireInternalToken }, async (request, reply) => {
    const items = request.body?.items;
    if (!Array.isArray(items)) return reply.code(400).send({ ok: false, error: 'items array is required' });

    try {
      await repo.upsertCatalog(items);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/catalog/:uid', { preHandler: requireInternalToken }, async (request, reply) => {
    const uid = String(request.params?.uid || '').trim();
    const lang = String(request.query?.lang || '').trim().toLowerCase() || null;

    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    const item = lang
      ? await repo.getCatalogItemLocalized(uid, lang)
      : await repo.getCatalogItem(uid);

    if (!item) return reply.code(404).send({ ok: false, error: 'not found' });
    return { ok: true, item };
  });

  app.get('/v1/catalog/:uid/watch-map', { preHandler: requireInternalToken }, async (request, reply) => {
    const uid = String(request.params?.uid || '').trim();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    const watchMap = await repo.getWatchMap(uid);
    return { ok: true, watchMap };
  });

  app.put('/v1/catalog/:uid/watch-map', { preHandler: requireInternalToken }, async (request, reply) => {
    const uid = String(request.params?.uid || '').trim();
    const watchSource = request.body?.watchSource;
    const watchUrl = request.body?.watchUrl;
    const watchTitle = request.body?.watchTitle ?? null;

    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    try {
      await repo.setWatchMap(uid, watchSource, watchUrl, watchTitle);
      return { ok: true };
    } catch (err) {
      return reply.code(err?.message === 'anime_not_found' ? 404 : 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/v1/catalog/:uid/watch-map', { preHandler: requireInternalToken }, async (request, reply) => {
    const uid = String(request.params?.uid || '').trim();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });

    const result = await repo.clearWatchMap(uid);
    return result;
  });

  // ---------------------------------------------------------------------------
  // Tracked Lists
  // ---------------------------------------------------------------------------

  app.post('/v1/list/:userId/tracked', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const listType = String(request.body?.listType || '').trim().toLowerCase();
    const anime = request.body?.anime;

    if (!listType) return reply.code(400).send({ ok: false, error: 'listType is required' });
    if (!anime?.uid) return reply.code(400).send({ ok: false, error: 'anime.uid is required' });

    try {
      await repo.addToTrackedList(userId, listType, anime);
      return { ok: true };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/v1/list/:userId/tracked/:listType/:uid', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const listType = String(request.params?.listType || '').trim().toLowerCase();
    const uid = String(request.params?.uid || '').trim();

    try {
      const removed = await repo.removeFromTrackedList(userId, listType, uid);
      return { ok: true, removed };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/tracked/:listType', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const listType = String(request.params?.listType || '').trim().toLowerCase();

    try {
      const items = await repo.getTrackedList(userId, listType);
      return { ok: true, items };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/watched-with-stats', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    try {
      const items = await repo.getWatchedWithFriendStats(userId);
      return { ok: true, items };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/watch-stats/:uid', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const uid = String(request.params?.uid || '').trim();

    try {
      const stats = await repo.getWatchStats(userId, uid);
      return { ok: true, ...stats };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  app.post('/v1/list/:userId/recommendations', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const anime = request.body?.anime;

    if (!anime?.uid) return reply.code(400).send({ ok: false, error: 'anime.uid is required' });

    try {
      await repo.addRecommendation(userId, anime);
      return { ok: true };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/v1/list/:userId/recommendations/:uid', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const uid = String(request.params?.uid || '').trim();

    try {
      const removed = await repo.removeRecommendation(userId, uid);
      return { ok: true, removed };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/recommendations/own', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    try {
      const items = await repo.getOwnRecommendations(userId);
      return { ok: true, items };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/recommendations/from-friends', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const limit = Number(request.query?.limit || 25);
    try {
      const items = await repo.getRecommendationsFromFriends(userId, limit);
      return { ok: true, items };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Existing list endpoints (backward-compatible)
  // ---------------------------------------------------------------------------

  app.get('/v1/list/:userId', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const lang = String(request.query?.lang || '').trim().toLowerCase() || 'en';
    const out = await repo.getListByTelegramId(userId, { lang });
    if (!out.user) return reply.code(404).send({ ok: false, error: 'user not found' });
    return { ok: true, ...out };
  });

  app.post('/v1/list/:userId/items', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const uid = String(request.body?.uid || '').trim();
    const listType = String(request.body?.listType || '').trim().toLowerCase();
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid is required' });
    if (!listType) return reply.code(400).send({ ok: false, error: 'listType is required' });

    try {
      const out = await repo.addListItem(userId, { uid, listType });
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.patch('/v1/list/:userId/items/:itemId', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const itemId = request.params?.itemId;
    try {
      const out = await repo.patchListItem(userId, itemId, {
        watchCountDelta: request.body?.watchCountDelta ?? null,
        watchCount: request.body?.watchCount ?? null
      });
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/v1/list/:userId/items/:itemId', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const itemId = request.params?.itemId;
    try {
      const out = await repo.deleteListItem(userId, itemId);
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Watch Progress
  // ---------------------------------------------------------------------------

  app.post('/v1/list/:userId/progress/start', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const animeUid = String(request.body?.animeUid || request.body?.uid || '').trim();
    const startedVia = String(request.body?.startedVia || '').trim().toLowerCase();
    const episodeLabel = String(request.body?.episode?.label || request.body?.episodeLabel || '').trim();
    const episodeNumber = request.body?.episode?.number ?? request.body?.episodeNumber ?? null;
    const source = request.body?.source ?? null;
    const quality = request.body?.quality ?? null;

    if (!animeUid) return reply.code(400).send({ ok: false, error: 'animeUid is required' });
    if (!episodeLabel) return reply.code(400).send({ ok: false, error: 'episode.label is required' });
    if (!startedVia) return reply.code(400).send({ ok: false, error: 'startedVia is required' });

    try {
      const out = await repo.upsertWatchProgress(userId, {
        animeUid,
        episodeLabel,
        episodeNumber,
        source,
        quality,
        startedVia
      });
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get('/v1/list/:userId/progress/recent', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const limit = Number(request.query?.limit || 5);
    const lang = String(request.query?.lang || '').trim().toLowerCase() || 'en';

    try {
      const out = await repo.getRecentWatchProgress(userId, { limit, lang });
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  app.delete('/v1/list/:userId/progress/:animeUid', { preHandler: requireInternalToken }, async (request, reply) => {
    const userId = request.params?.userId;
    const animeUid = String(request.params?.animeUid || '').trim();
    try {
      const out = await repo.deleteWatchProgress(userId, animeUid);
      return { ok: true, ...out };
    } catch (err) {
      return reply.code(err?.status || 400).send({ ok: false, error: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Server lifecycle
  // ---------------------------------------------------------------------------

  const close = async () => {
    try {
      await db.destroy();
    } catch {
      // ignore
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
