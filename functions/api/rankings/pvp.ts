// GET/POST /api/rankings/pvp - PvP 랭킹 조회/갱신
import type { D1Database } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

// 유저 존재 확인 및 생성
async function ensureUser(DB: D1Database, userId: string) {
  const existing = await DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!existing) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, is_anonymous) VALUES (?, 1)').bind(userId).run();
  }
}

// GET - 랭킹 조회
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  try {
    const result = await DB.prepare(`
      SELECT 
        r.user_id,
        COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 4)) as nickname,
        r.pvp_wins,
        r.pvp_losses,
        r.pvp_rating,
        CASE WHEN (r.pvp_wins + r.pvp_losses) > 0 
          THEN ROUND(r.pvp_wins * 100.0 / (r.pvp_wins + r.pvp_losses), 1)
          ELSE 0 
        END as win_rate
      FROM rankings r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE (r.pvp_wins + r.pvp_losses) > 0
      ORDER BY r.pvp_rating DESC, r.pvp_wins DESC
      LIMIT ?
    `).bind(limit).all();

    return Response.json({
      success: true,
      rankings: result.results || []
    });
  } catch (error) {
    console.error('[rankings/pvp] Error:', error);
    return Response.json({ success: false, error: 'Failed to fetch rankings' }, { status: 500 });
  }
};

interface PvPResult {
  isWin: boolean;
  opponentRating?: number;
}

// ELO 레이팅 계산
function calculateElo(myRating: number, opponentRating: number, isWin: boolean): number {
  const K = 32; // K-factor
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
  const actualScore = isWin ? 1 : 0;
  return Math.round(myRating + K * (actualScore - expectedScore));
}

// POST - 결과 기록
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  
  const userId = context.request.headers.get('x-user-id');
  if (!userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: PvPResult = await context.request.json();
    const { isWin, opponentRating = 1000 } = body;

    // 유저 존재 확인
    await ensureUser(DB, userId);

    // 현재 기록 조회
    const current = await DB.prepare(
      'SELECT pvp_wins, pvp_losses, pvp_rating FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ pvp_wins: number; pvp_losses: number; pvp_rating: number }>();

    const currentRating = current?.pvp_rating || 1000;
    const newRating = calculateElo(currentRating, opponentRating, isWin);

    if (!current) {
      // 새 레코드
      await DB.prepare(`
        INSERT INTO rankings (user_id, pvp_wins, pvp_losses, pvp_rating)
        VALUES (?, ?, ?, ?)
      `).bind(userId, isWin ? 1 : 0, isWin ? 0 : 1, newRating).run();
    } else {
      // 기록 갱신
      if (isWin) {
        await DB.prepare(`
          UPDATE rankings SET pvp_wins = pvp_wins + 1, pvp_rating = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).bind(newRating, userId).run();
      } else {
        await DB.prepare(`
          UPDATE rankings SET pvp_losses = pvp_losses + 1, pvp_rating = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).bind(newRating, userId).run();
      }
    }

    return Response.json({ 
      success: true, 
      newRating,
      ratingChange: newRating - currentRating
    });
  } catch (error) {
    console.error('[rankings/pvp] POST Error:', error);
    return Response.json({ success: false, error: 'Failed to update ranking' }, { status: 500 });
  }
};
