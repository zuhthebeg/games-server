/**
 * GET  /api/rankings/daily?type=weapon|hunt|pvp  — 오늘 랭킹 TOP N
 * POST /api/rankings/daily                        — 점수 업데이트
 */
import { CORS, upsertDailyScore, todayKST, RANK_TYPES } from './_rank_utils';
import type { RankType } from './_rank_utils';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { DB } = env;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') as RankType;
  if (!RANK_TYPES.includes(type)) {
    return Response.json({ error: 'invalid type' }, { status: 400, headers: CORS });
  }

  const today = todayKST();
  const cfg = await DB.prepare('SELECT top_n, gold_reward, period, next_reset_at FROM rank_configs WHERE rank_type = ?').bind(type).first<any>();
  const limit = cfg?.top_n ?? 10;

  const rows = await DB.prepare(`
    SELECT d.user_id, MAX(d.score) as score,
           COALESCE(u.nickname, '익명#' || substr(d.user_id, 1, 4)) as nickname
    FROM rank_daily d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.rank_type = ? AND d.date = ?
    GROUP BY d.user_id
    ORDER BY score DESC
    LIMIT ?
  `).bind(type, today, limit).all<any>();

  return Response.json({
    type,
    date: today,
    next_reset_at: cfg?.next_reset_at,
    period: cfg?.period ?? 'daily',
    gold_reward: cfg?.gold_reward ?? 100000,
    rankings: (rows.results ?? []).map((r: any, i: number) => ({ rank: i + 1, ...r })),
  }, { headers: CORS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { DB } = env;
  const body = await request.json<{ user_id: string; rank_type: RankType; score: number }>();

  if (!body.user_id || !RANK_TYPES.includes(body.rank_type) || typeof body.score !== 'number') {
    return Response.json({ error: 'invalid params' }, { status: 400, headers: CORS });
  }

  await upsertDailyScore(DB, body.user_id, body.rank_type, body.score);
  return Response.json({ ok: true }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
