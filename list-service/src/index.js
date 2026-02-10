import Fastify from 'fastify';
import { buildDb } from './db/knex.js';
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
  const repo = new ListRepository(db);

  app.get('/healthz', async (request, reply) => {
    const dbHealth = await repo.checkHealth();
    if (!dbHealth.ok) return reply.code(503).send({ ok: false, database: dbHealth });
    return { ok: true, database: dbHealth, uptimeSec: Math.floor(process.uptime()) };
  });

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

