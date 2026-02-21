// GET /api/rankings/weapons - 무기 랭킹 조회
import type { D1Database } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  try {
    const result = await DB.prepare(`
      SELECT 
        r.user_id,
        COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 4)) as nickname,
        r.best_weapon_level,
        r.best_weapon_name,
        r.best_weapon_grade,
        r.best_weapon_element,
        r.best_weapon_image,
        r.best_weapon_achieved_at
      FROM rankings r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.best_weapon_level > 0
      ORDER BY r.best_weapon_level DESC, r.best_weapon_achieved_at ASC
      LIMIT ?
    `).bind(limit).all();

    return Response.json({
      success: true,
      rankings: result.results || []
    });
  } catch (error) {
    console.error('[rankings/weapons] Error:', error);
    return Response.json({ success: false, error: 'Failed to fetch rankings' }, { status: 500 });
  }
};
