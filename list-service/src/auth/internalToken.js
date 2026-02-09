export function requireInternalToken(request, reply) {
  const expected = String(process.env.INTERNAL_SERVICE_TOKEN || '').trim();
  if (!expected) return; // allow when not configured (dev-friendly)
  const got = String(request.headers['x-internal-service-token'] || '').trim();
  if (got !== expected) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
  }
}

