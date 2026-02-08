import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTelegramWebAppInitData } from './telegramAuth.js';

export async function startApiServer({
  repository,
  port,
  telegramToken,
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
