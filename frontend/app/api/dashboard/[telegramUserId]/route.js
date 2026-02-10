export async function GET(_request, { params }) {
  const backend =
    (process.env.BACKEND_URL || '').trim() ||
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:8080' : '');
  if (!backend) {
    return Response.json(
      { ok: false, error: 'BACKEND_URL is not set (e.g. http://localhost:8080)' },
      { status: 500 }
    );
  }

  const telegramUserId = encodeURIComponent(String(params.telegramUserId || ''));

  let upstream;
  try {
    upstream = await fetch(`${backend}/api/dashboard/${telegramUserId}`, { method: 'GET' });
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
    headers: {
      'content-type': contentType
    }
  });
}
