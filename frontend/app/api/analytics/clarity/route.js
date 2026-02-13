export async function GET() {
  const projectId = String(
    process.env.CLARITY_PROJECT_ID || process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || ''
  ).trim();

  return Response.json(
    { ok: true, projectId: projectId || null },
    { headers: { 'cache-control': 'no-store' } }
  );
}
