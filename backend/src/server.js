import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTelegramWebAppInitData } from './telegramAuth.js';
import { config } from './config.js';
import { watchEpisodes, watchSearch, watchSourcesForEpisode, watchVideos } from './services/watchApiClient.js';

/**
 * Extracts safe metadata from Telegram initData string for debugging.
 * Never logs the raw initData value.
 * @param {unknown} initDataRaw
 */
function extractInitDataMeta(initDataRaw) {
  const initData = String(initDataRaw || '').trim();
  if (!initData) return null;

  // Never log the raw initData (contains user + hash).
  const params = new URLSearchParams(initData);
  const authDate = Number(params.get('auth_date') || 0);

  let userId = null;
  try {
    const userRaw = params.get('user');
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (user?.id) userId = String(user.id);
    }
  } catch {
    // ignore
  }

  return {
    initDataLen: initData.length,
    hasHash: Boolean(params.get('hash')),
    hasUser: Boolean(params.get('user')),
    authDate: Number.isFinite(authDate) ? authDate : null,
    userId
  };
}

function buildInviteLink(token) {
  if (!config.botUsername) return null;
  return `https://t.me/${config.botUsername}?start=${token}`;
}

/**
 * Starts Fastify HTTP server with:
 * - static assets (legacy mini app)
 * - `/app` which redirects to `webAppUrl` when provided (Next.js mini app)
 * - healthcheck and Telegram endpoints
 *
 * @param {Object} opts
 * @param {import('./db.js').AnimeRepository} opts.repository
 * @param {number} opts.port
 * @param {string} opts.telegramToken
 * @param {string=} opts.webAppUrl
 * @param {number} opts.webAppAuthMaxAgeSec
 * @param {any} opts.bot
 * @param {string} opts.telegramWebhookPath
 * @param {string} opts.telegramWebhookSecret
 */
export async function startApiServer({
  repository,
  port,
  telegramToken,
  webAppUrl,
  webAppAuthMaxAgeSec,
  bot,
  telegramWebhookPath,
  telegramWebhookSecret
}) {
  const app = Fastify({
    logger: {
      level: 'info'
    }
  });
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  await app.register(cors, {
    origin: true
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/'
  });

  app.get('/app', async (request, reply) => {
    const target = String(webAppUrl || '').trim();
    if (target) {
      return reply.redirect(target);
    }
    return reply.sendFile('index.html');
  });

  app.get('/health', async (request, reply) => {
    const dbHealth = await repository.checkHealth();
    if (!dbHealth.ok) {
      return reply.code(503).send({
        ok: false,
        database: dbHealth,
        uptimeSec: Math.floor(process.uptime())
      });
    }

    return {
      ok: true,
      database: dbHealth,
      uptimeSec: Math.floor(process.uptime())
    };
  });

  // Telegram webhook endpoint. Must respond 200 quickly.
  app.post(telegramWebhookPath || '/webhook', async (request, reply) => {
    const expectedSecret = telegramWebhookSecret || '';
    if (expectedSecret) {
      const headerSecret = request.headers['x-telegram-bot-api-secret-token'];
      if (headerSecret !== expectedSecret) {
        app.log.warn({ hasHeader: Boolean(headerSecret) }, 'telegram webhook secret mismatch');
        return reply.code(401).send({ ok: false });
      }
    }

    const update = request.body;

    // Reply immediately; process update async.
    reply.code(200).send({ ok: true });

    if (!bot) {
      app.log.warn('telegram webhook received but bot is disabled');
      return;
    }

    if (!update || typeof update !== 'object') {
      app.log.warn({ bodyType: typeof update }, 'telegram webhook body is not an object');
      return;
    }

    setImmediate(async () => {
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        app.log.error({ err: error }, 'failed to handle telegram update');
      }
    });
  });

  app.post('/api/telegram/validate-init-data', async (request, reply) => {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      return reply.code(400).send({ ok: false, error: 'initData is required' });
    }

    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: telegramToken,
      maxAgeSec: webAppAuthMaxAgeSec
    });

    if (!validation.ok) {
      app.log.warn({ error: validation.error }, 'telegram initData validation failed');
      return reply.code(401).send(validation);
    }

    return {
      ok: true,
      telegramUserId: validation.telegramUserId,
      user: validation.user,
      authDate: validation.authDate
    };
  });

  app.post('/api/webapp/dashboard', async (request, reply) => {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      return reply.code(400).send({ ok: false, error: 'initData is required' });
    }

    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: telegramToken,
      maxAgeSec: webAppAuthMaxAgeSec
    });

    if (!validation.ok) {
      const meta = extractInitDataMeta(initData);
      app.log.warn(
        { error: validation.error, meta },
        'telegram initData validation failed (webapp dashboard)'
      );
      return reply.code(401).send(validation);
    }

    const dashboard = await repository.getDashboard(validation.telegramUserId);
    if (!dashboard.user) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }

    return {
      ok: true,
      telegramUserId: validation.telegramUserId,
      ...dashboard
    };
  });

  app.post('/api/webapp/invite', async (request, reply) => {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      return reply.code(400).send({ ok: false, error: 'initData is required' });
    }

    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: telegramToken,
      maxAgeSec: webAppAuthMaxAgeSec
    });

    if (!validation.ok) {
      const meta = extractInitDataMeta(initData);
      app.log.warn({ error: validation.error, meta }, 'telegram initData validation failed (webapp invite)');
      return reply.code(401).send(validation);
    }

    const token = await repository.createInviteToken(validation.user || { id: validation.telegramUserId });
    const link = buildInviteLink(token);
    if (!link) {
      return reply.code(500).send({ ok: false, error: 'TELEGRAM_BOT_USERNAME is not set' });
    }

    return { ok: true, token, link };
  });

  app.post('/api/webapp/lang', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const lang = String(request.body?.lang || '').trim().toLowerCase();
    if (!lang) {
      return reply.code(400).send({ ok: false, error: 'lang is required' });
    }

    const out = await repository.setUserLang(validation.telegramUserId, lang);
    if (!out.ok) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }

    return { ok: true, lang: out.lang };
  });

  function validateInitDataOrReply(request, reply) {
    const initData = request.body?.initData;
    if (typeof initData !== 'string' || !initData.trim()) {
      reply.code(400).send({ ok: false, error: 'initData is required' });
      return null;
    }

    const validation = validateTelegramWebAppInitData({
      initData,
      botToken: telegramToken,
      maxAgeSec: webAppAuthMaxAgeSec
    });

    if (!validation.ok) {
      const meta = extractInitDataMeta(initData);
      app.log.warn({ error: validation.error, meta }, 'telegram initData validation failed (webapp)');
      reply.code(401).send(validation);
      return null;
    }

    return validation;
  }

  app.post('/api/webapp/watch/search', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const uid = String(request.body?.uid || '').trim();
    let q = String(request.body?.q || '').trim();
    const source = request.body?.source ? String(request.body.source) : '';
    const limit = Number(request.body?.limit || 5);

    const user = await repository.getUserByTelegramId(validation.telegramUserId);
    if (!user) {
      return reply.code(404).send({ ok: false, error: 'User not found. Open bot and run /start first.' });
    }

    let map = uid ? await repository.getWatchMap(uid) : null;

    if (!q && uid) {
      const anime = await repository.getCatalogItemLocalized(uid, user.lang || 'en');
      if (!anime) {
        return reply.code(404).send({ ok: false, error: 'anime not found' });
      }
      q = anime.title;
    }

    if (!q) return reply.code(400).send({ ok: false, error: 'q or uid is required' });

    const preferredSource = source || map?.watchSource || '';

    try {
      const out = await watchSearch({ q, source: preferredSource || null, limit: Number.isFinite(limit) ? limit : 5 });
      const items = Array.isArray(out?.items) ? out.items : [];

      let autoPick = null;
      if (map?.watchUrl) {
        const match = items.find((it) => String(it?.url || '').trim() === String(map.watchUrl).trim());
        if (match?.animeRef) {
          autoPick = match;
        }
      }

      // If no mapping exists yet and the search is unambiguous, bind automatically.
      if (!map && uid && items.length === 1) {
        const only = items[0];
        const watchSource = String(only?.source || '').trim();
        const watchUrl = String(only?.url || '').trim();
        if (watchSource && watchUrl) {
          try {
            await repository.setWatchMap(uid, watchSource, watchUrl, String(only?.title || '').trim() || null);
            map = await repository.getWatchMap(uid);
            if (only?.animeRef) autoPick = only;
          } catch {
            // ignore autobind failure
          }
        }
      }

      // If we have a stored mapping, reorder list with exact match first.
      const ordered = autoPick
        ? [autoPick, ...items.filter((it) => it !== autoPick)]
        : items;

      return reply.send({
        ok: true,
        items: ordered,
        map: map ? { uid, watchSource: map.watchSource, watchUrl: map.watchUrl, watchTitle: map.watchTitle } : null,
        autoPick
      });
    } catch (error) {
      return reply.code(error?.status || 502).send({ ok: false, error: error?.message || String(error) });
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
      await repository.setWatchMap(uid, watchSource, watchUrl, watchTitle);
      return reply.send({ ok: true });
    } catch (error) {
      const msg = error?.message === 'anime_not_found' ? 'anime not found' : (error?.message || String(error));
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
    } catch (error) {
      return reply.code(400).send({ ok: false, error: error?.message || String(error) });
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
    } catch (error) {
      return reply.code(error?.status || 502).send({ ok: false, error: error?.message || String(error) });
    }
  });

  app.post('/api/webapp/watch/sources', async (request, reply) => {
    const validation = validateInitDataOrReply(request, reply);
    if (!validation) return;

    const animeRef = String(request.body?.animeRef || '').trim();
    const episodeNum = String(request.body?.episodeNum || '').trim();
    if (!animeRef) return reply.code(400).send({ ok: false, error: 'animeRef is required' });
    if (!episodeNum) return reply.code(400).send({ ok: false, error: 'episodeNum is required' });

    try {
      const out = await watchSourcesForEpisode({ animeRef, episodeNum });
      return reply.send(out);
    } catch (error) {
      return reply.code(error?.status || 502).send({ ok: false, error: error?.message || String(error) });
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
    } catch (error) {
      return reply.code(error?.status || 502).send({ ok: false, error: error?.message || String(error) });
    }
  });

  // Client-side diagnostic logs from the Mini App (optional).
  app.post('/api/client-log', async (request, reply) => {
    const body = request.body || {};
    const event = typeof body.event === 'string' ? body.event.slice(0, 64) : 'unknown';
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : null;
    const data = body.data && typeof body.data === 'object' ? body.data : null;

    app.log.info(
      {
        event,
        message,
        data,
        ua: request.headers['user-agent'] || null,
        ip: request.ip
      },
      'client-log'
    );

    return reply.send({ ok: true });
  });

  // Legacy/debug endpoint. Mini App should use /api/webapp/dashboard.
  app.get('/api/dashboard/:telegramUserId', async (request, reply) => {
    const { telegramUserId } = request.params;
    const dashboard = await repository.getDashboard(telegramUserId);

    if (!dashboard.user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return {
      telegramUserId: String(telegramUserId),
      ...dashboard
    };
  });

  app.get('/api/users/:telegramUserId/watch-stats/:uid', async (request, reply) => {
    const { telegramUserId, uid } = request.params;
    const user = await repository.getUserByTelegramId(telegramUserId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const stats = await repository.getWatchStats(telegramUserId, uid);
    return {
      telegramUserId: String(telegramUserId),
      uid,
      ...stats
    };
  });

  app.get('/api/users/:telegramUserId/friends', async (request, reply) => {
    const { telegramUserId } = request.params;
    const user = await repository.getUserByTelegramId(telegramUserId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const friends = await repository.getFriends(telegramUserId);
    return {
      telegramUserId: String(telegramUserId),
      friends
    };
  });

  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
