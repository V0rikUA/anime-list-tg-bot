import Fastify from 'fastify';
import { getOrCreateRequestId, proxyFetch, readRawBody, sanitizeInboundHeaders } from './proxy.js';

function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function requireEnv(name, fallback = '') {
  const v = String(process.env[name] || fallback).trim();
  if (!v) throw new Error(`${name} is required`);
  return v.replace(/\/+$/, '');
}

function jsonError(reply, { status = 502, error, requestId }) {
  reply.code(status).header('content-type', 'application/json').header('x-request-id', requestId);
  reply.send({ ok: false, status, error: String(error || 'Upstream failure'), requestId });
}

function buildUpstreamUrl(base, incomingUrl, { stripPrefix = '' } = {}) {
  const u = new URL(incomingUrl, 'http://gateway.local');
  const path = stripPrefix && u.pathname.startsWith(stripPrefix)
    ? u.pathname.slice(stripPrefix.length) || '/'
    : u.pathname;
  const out = new URL(`${base}${path.startsWith('/') ? '' : '/'}${path}`);
  out.search = u.search;
  return out.toString();
}

async function main() {
  const app = Fastify({ logger: { level: 'info' } });

  const port = envInt('PORT', 8080);
  const timeoutMs = envInt('UPSTREAM_TIMEOUT_MS', 10_000);
  const getRetryMax = envInt('GET_RETRY_MAX', 2);

  const upstreamWebapp = requireEnv('UPSTREAM_WEBAPP_URL', process.env.UPSTREAM_BACKEND_URL || 'http://webapp:8080');
  const upstreamCatalog = requireEnv('UPSTREAM_CATALOG_URL', 'http://catalog:8080');
  const upstreamList = requireEnv('UPSTREAM_LIST_URL', 'http://list:8080');
  const upstreamWatch = requireEnv('UPSTREAM_WATCH_URL', 'http://watch-api:8000');
  const upstreamBot = requireEnv('UPSTREAM_BOT_URL', 'http://bot:8080');
  const internalToken = String(process.env.INTERNAL_SERVICE_TOKEN || '').trim();
  const backendWebhookPath = String(process.env.BACKEND_WEBHOOK_PATH || '/webhook').trim() || '/webhook';

  // Request ID correlation (set early, always return it).
  app.addHook('onRequest', async (request, reply) => {
    const rid = getOrCreateRequestId(request);
    request.requestId = rid;
    reply.header('x-request-id', rid);
  });

  app.get('/healthz', async (request, reply) => {
    const rid = request.requestId || getOrCreateRequestId(request);
    reply.header('content-type', 'application/json');
    return { ok: true, uptimeSec: Math.floor(process.uptime()), requestId: rid };
  });

  async function handleProxy(request, reply, { upstreamBase, stripPrefix = '', forcePath = null, addInternalToken = false } = {}) {
    const rid = request.requestId || getOrCreateRequestId(request);
    const incomingUrl = request.raw.url || request.url || '/';
    const upstreamUrl = forcePath
      ? new URL(forcePath, `${upstreamBase}/`).toString()
      : buildUpstreamUrl(upstreamBase, incomingUrl, { stripPrefix });

    const headers = sanitizeInboundHeaders(request.headers);
    headers['x-request-id'] = rid;
    if (addInternalToken && internalToken) {
      headers['x-internal-service-token'] = internalToken;
    }

    let body = null;
    try {
      body = await readRawBody(request);
    } catch (err) {
      return jsonError(reply, { status: 400, error: `failed to read body: ${err?.message || String(err)}`, requestId: rid });
    }

    try {
      const res = await proxyFetch({
        method: request.method,
        upstreamUrl,
        headers,
        body,
        timeoutMs,
        getRetryMax
      });

      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'application/octet-stream';

      reply.code(res.status);
      reply.header('content-type', contentType);

      // Pass through set-cookie if present (safe; some clients may rely on it).
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) reply.header('set-cookie', setCookie);

      return reply.send(buf);
    } catch (err) {
      return jsonError(reply, { status: 502, error: err?.message || String(err), requestId: rid });
    }
  }

  // Telegram webhook terminated at gateway; proxied internally to bot-service.
  app.post('/webhook', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamBot, forcePath: backendWebhookPath });
  });

  // New microservice APIs (parallel).
  app.get('/api/v1/catalog/search', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamCatalog, stripPrefix: '/api', addInternalToken: true });
  });
  app.all('/api/v1/list/*', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamList, stripPrefix: '/api', addInternalToken: true });
  });
  app.all('/api/v1/list', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamList, stripPrefix: '/api', addInternalToken: true });
  });

  // Watch passthrough: /api/watch/* -> watch-service /*
  app.all('/api/watch/*', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamWatch, stripPrefix: '/api/watch' });
  });
  app.all('/api/watch', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamWatch, stripPrefix: '/api/watch' });
  });

  // Webapp passthrough: preserve existing /api/* paths for Mini App.
  app.all('/api/*', async (request, reply) => {
    return handleProxy(request, reply, { upstreamBase: upstreamWebapp });
  });

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
