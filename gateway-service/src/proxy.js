import crypto from 'node:crypto';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

export function getOrCreateRequestId(request) {
  const existing = String(request.headers['x-request-id'] || '').trim();
  return existing || crypto.randomUUID();
}

export function sanitizeInboundHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k || '').toLowerCase();
    if (!key || HOP_BY_HOP.has(key)) continue;
    if (key === 'x-internal-service-token') continue; // never trust client-provided internal token
    out[key] = v;
  }
  return out;
}

export async function readRawBody(request) {
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;

  const chunks = [];
  for await (const chunk of request.raw) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function isRetryableGet(method, attempt, maxRetries) {
  return method === 'GET' && attempt < maxRetries;
}

export async function proxyFetch({
  method,
  upstreamUrl,
  headers,
  body,
  timeoutMs,
  getRetryMax = 0,
  retryBackoffMs = 150
}) {
  const m = String(method || 'GET').toUpperCase();

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        upstreamUrl,
        {
          method: m,
          headers,
          body: body ?? undefined
        },
        timeoutMs
      );

      if (m === 'GET' && (res.status === 502 || res.status === 503 || res.status === 504) && isRetryableGet(m, attempt, getRetryMax)) {
        // Drain body to free resources, then retry.
        await res.arrayBuffer().catch(() => null);
        await sleep(retryBackoffMs * (attempt + 1));
        continue;
      }

      return res;
    } catch (err) {
      if (isRetryableGet(m, attempt, getRetryMax)) {
        await sleep(retryBackoffMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

