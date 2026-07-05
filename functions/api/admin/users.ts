// 어드민 유저 CRUD — games-relay-db users (game.cocy.io 전 게임 + log.cocy.io 공용 계정)
const ADMIN_SECRET = 'cocy-admin-2026';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
};

type Env = { DB: D1Database };

const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
const isAuthed = (req: Request) => req.headers.get('X-Admin-Secret') === ADMIN_SECRET;

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  if (!isAuthed(ctx.request)) return unauthorized();
  const url = new URL(ctx.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

  let where = '';
  const binds: string[] = [];
  if (q) {
    where = `WHERE (id LIKE ? OR nickname LIKE ? OR email LIKE ?)`;
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const [rows, total] = await Promise.all([
    ctx.env.DB.prepare(
      `SELECT id, nickname, email, is_anonymous, email_verified,
              (google_id IS NOT NULL) AS has_google, avatar_url, created_at, last_seen_at
       FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),
    ctx.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`).bind(...binds).first<{ cnt: number }>(),
  ]);

  const users = (rows.results as any[]).map((u) => ({
    id: u.id,
    nickname: u.nickname,
    email: u.email,
    provider: u.has_google ? 'google' : u.email ? 'email' : 'anon',
    is_anonymous: !!u.is_anonymous,
    email_verified: !!u.email_verified,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
  }));

  return Response.json({ users, total: total?.cnt ?? 0, limit, offset }, { headers: CORS });
};

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  if (!isAuthed(ctx.request)) return unauthorized();
  const body = await ctx.request.json().catch(() => null) as { id?: string; nickname?: string; email?: string } | null;
  if (!body?.id) return Response.json({ error: 'id required' }, { status: 400, headers: CORS });

  const sets: string[] = [];
  const binds: (string | null)[] = [];
  if (body.nickname !== undefined) { sets.push('nickname = ?'); binds.push(body.nickname || null); }
  if (body.email !== undefined) { sets.push('email = ?'); binds.push(body.email || null); }
  if (!sets.length) return Response.json({ error: 'no fields' }, { status: 400, headers: CORS });
  sets.push("updated_at = datetime('now')");

  const res = await ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, body.id).run();
  return Response.json({ ok: true, changed: res.meta.changes }, { headers: CORS });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  if (!isAuthed(ctx.request)) return unauthorized();
  const id = new URL(ctx.request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: CORS });

  // 랭킹 등 부속 레코드 먼저 제거 후 계정 삭제. log-db(entries 등)는 별도 DB라 여기서 못 지움.
  await ctx.env.DB.prepare('DELETE FROM rankings WHERE user_id = ?').bind(id).run().catch(() => {});
  const res = await ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return Response.json({ ok: true, changed: res.meta.changes }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
