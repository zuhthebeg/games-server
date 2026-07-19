// /api/admin/voicematch-requests — 보이스매치 가수추가 요청 큐.
// 어드민 UI가 POST로 쌓고, 로컬 파이프라인 cron이 GET(pending)→처리→PATCH(done/failed)로 드레인한다.
const ADMIN_SECRET = 'cocy-admin-2026-r1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

async function ensureTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS voicematch_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
  )`).run();
}

function auth(req: Request) {
  return req.headers.get('X-Admin-Secret') === ADMIN_SECRET;
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (!auth(ctx.request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  await ensureTable(ctx.env.DB);
  const status = new URL(ctx.request.url).searchParams.get('status');
  const rows = status
    ? await ctx.env.DB.prepare('SELECT * FROM voicematch_requests WHERE status=? ORDER BY id DESC LIMIT 100').bind(status).all()
    : await ctx.env.DB.prepare('SELECT * FROM voicematch_requests ORDER BY id DESC LIMIT 100').all();
  return Response.json({ requests: rows.results }, { headers: CORS });
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (!auth(ctx.request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  await ensureTable(ctx.env.DB);
  const body = await ctx.request.json().catch(() => null) as { artist?: string; note?: string } | null;
  const artist = (body?.artist || '').trim().slice(0, 60);
  if (!artist) return Response.json({ error: 'artist required' }, { status: 400, headers: CORS });
  const dup = await ctx.env.DB.prepare(
    "SELECT id FROM voicematch_requests WHERE artist=? AND status='pending'").bind(artist).first();
  if (dup) return Response.json({ error: 'already pending', id: dup.id }, { status: 409, headers: CORS });
  const r = await ctx.env.DB.prepare(
    'INSERT INTO voicematch_requests (artist, note) VALUES (?, ?) RETURNING *')
    .bind(artist, (body?.note || '').slice(0, 200) || null).first();
  return Response.json({ request: r }, { headers: CORS });
};

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (!auth(ctx.request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  await ensureTable(ctx.env.DB);
  const body = await ctx.request.json().catch(() => null) as { id?: number; status?: string; result?: string } | null;
  if (!body?.id || !['pending', 'processing', 'done', 'failed', 'canceled'].includes(body.status || ''))
    return Response.json({ error: 'id + valid status required' }, { status: 400, headers: CORS });
  const r = await ctx.env.DB.prepare(
    `UPDATE voicematch_requests SET status=?, result=?, done_at=CASE WHEN ? IN ('done','failed','canceled') THEN datetime('now') ELSE done_at END WHERE id=? RETURNING *`)
    .bind(body.status, (body.result || '').slice(0, 300) || null, body.status, body.id).first();
  if (!r) return Response.json({ error: 'not found' }, { status: 404, headers: CORS });
  return Response.json({ request: r }, { headers: CORS });
};
