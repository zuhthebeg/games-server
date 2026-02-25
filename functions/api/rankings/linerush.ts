// GET/POST /api/rankings/linerush — 최고 스테이지 랭킹
import type { D1Database } from '@cloudflare/workers-types';

interface Env { DB: D1Database; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function ensureColumn(DB: D1Database) {
  try {
    await DB.prepare('ALTER TABLE rankings ADD COLUMN linerush_best_stage INTEGER DEFAULT 0').run();
  } catch { /* already exists */ }
  try {
    await DB.prepare('ALTER TABLE rankings ADD COLUMN linerush_updated_at TEXT').run();
  } catch { /* already exists */ }
}

async function ensureUser(DB: D1Database, userId: string, nickname?: string) {
  await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)')
    .bind(userId, nickname || null).run();
  if (nickname) {
    await DB.prepare('UPDATE users SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname != ?)')
      .bind(nickname, userId, nickname).run();
  }
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

// GET — 랭킹 조회
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);

  try {
    await ensureColumn(DB);
    const result = await DB.prepare(`
      SELECT
        r.user_id,
        COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 6)) AS nickname,
        COALESCE(r.linerush_best_stage, 0) AS best_stage,
        r.linerush_updated_at AS updated_at
      FROM rankings r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE COALESCE(r.linerush_best_stage, 0) > 0
      ORDER BY r.linerush_best_stage DESC, r.linerush_updated_at ASC
      LIMIT ?
    `).bind(limit).all();

    return Response.json({ success: true, rankings: result.results || [] }, { headers: CORS });
  } catch (error) {
    console.error('[rankings/linerush] GET error:', error);
    return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
  }
};

// POST — 기록 갱신
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  try {
    const body: { userId?: string; nickname?: string; stage: number } =
      await context.request.json();

    const userId = body.userId || context.request.headers.get('x-user-id');
    if (!userId || !body.stage || body.stage < 1) {
      return Response.json({ success: false, error: 'userId and stage required' }, { status: 400, headers: CORS });
    }

    await ensureColumn(DB);
    await ensureUser(DB, userId, body.nickname);

    // INSERT OR IGNORE + UPDATE only if new stage is better
    await DB.prepare('INSERT OR IGNORE INTO rankings (user_id) VALUES (?)').bind(userId).run();
    const updated = await DB.prepare(`
      UPDATE rankings
      SET linerush_best_stage = ?, linerush_updated_at = datetime('now')
      WHERE user_id = ? AND (COALESCE(linerush_best_stage, 0) < ?)
    `).bind(body.stage, userId, body.stage).run();

    // Fetch current best
    const row = await DB.prepare(
      'SELECT linerush_best_stage FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ linerush_best_stage: number }>();

    return Response.json({
      success: true,
      updated: (updated.meta?.changes || 0) > 0,
      bestStage: row?.linerush_best_stage || body.stage,
    }, { headers: CORS });
  } catch (error) {
    console.error('[rankings/linerush] POST error:', error);
    return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
  }
};
