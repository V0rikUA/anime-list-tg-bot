/**
 * Shared proxy fetch helper for Next.js API routes.
 * Forwards POST requests to the backend with a timeout.
 */

const DEFAULT_TIMEOUT_MS = 25000;

export function getBackendUrl() {
  return (
    (process.env.BACKEND_URL || '').trim() ||
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:8080' : '')
  );
}

export async function proxyPost(backendPath, request, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const backend = getBackendUrl();
  if (!backend) {
    return Response.json(
      { ok: false, error: 'BACKEND_URL is not set (e.g. http://localhost:8080)' },
      { status: 500 }
    );
  }

  const bodyText = await request.text();

  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    upstream = await fetch(`${backend}${backendPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (error) {
    return Response.json(
      { ok: false, error: `Upstream fetch failed: ${error?.message || String(error)}` },
      { status: 502 }
    );
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': contentType }
  });
}
