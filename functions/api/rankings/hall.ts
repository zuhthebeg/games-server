/**
 * GET /api/rankings/hall?type=weapon|hunt|pvp  — 명예의 전당
 */
import { CORS, RANK_TYPES } from './_rank_utils';
import type { RankType } from './_rank_utils';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { DB } = env;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') as RankType;
  if (!RANK_TYPES.includes(type)) {
    return Response.json({ error: 'invalid type' }, { status: 400, headers: CORS });
  }

  const rows = await DB.prepare(`
    SELECT h.user_id, h.best_score, h.best_rank, h.best_date,
           h.total_wins, h.total_gold,
           COALESCE(u.nickname, '익명#' || substr(h.user_id, 1, 4)) as nickname
    FROM hall_of_fame h
    LEFT JOIN users u ON h.user_id = u.id
    WHERE h.rank_type = ?
    ORDER BY h.best_score DESC
    LIMIT 20
  `).bind(type).all<any>();

  return Response.json({
    type,
    hall: rows.results ?? [],
  }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
