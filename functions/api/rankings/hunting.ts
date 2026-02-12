// GET/POST /api/rankings/hunting - 사냥 랭킹 조회/갱신
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
  const type = url.searchParams.get('type') || 'kills'; // 'kills' or 'streak'

  try {
    const orderBy = type === 'streak' 
      ? 'r.max_kill_streak DESC' 
      : 'r.total_kills DESC';

    const result = await DB.prepare(`
      SELECT 
        r.user_id,
        COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 4)) as nickname,
        r.total_kills,
        r.max_kill_streak
      FROM rankings r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.total_kills > 0
      ORDER BY ${orderBy}
      LIMIT ?
    `).bind(limit).all();

    return Response.json({
      success: true,
      rankings: result.results || []
    });
  } catch (error) {
    console.error('[rankings/hunting] Error:', error);
    return Response.json({ success: false, error: 'Failed to fetch rankings' }, { status: 500 });
  }
};

interface HuntingRecord {
  userId?: string;
  kills: number;
  killStreak?: number;
}

// POST - 기록 갱신
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;

  try {
    const body: HuntingRecord = await context.request.json();
    const userId = body.userId || context.request.headers.get('x-user-id');
    const { kills, killStreak } = body;

    if (!userId) {
      return Response.json({ success: false, error: 'Missing userId' }, { status: 400 });
    }

    if (typeof kills !== 'number' || kills < 0) {
      return Response.json({ success: false, error: 'Invalid kills count' }, { status: 400 });
    }

    // 유저 존재 확인
    await ensureUser(DB, userId);

    // UPSERT로 기록 갱신
    const current = await DB.prepare(
      'SELECT total_kills, max_kill_streak FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ total_kills: number; max_kill_streak: number }>();

    if (!current) {
      // 새 레코드
      await DB.prepare(`
        INSERT INTO rankings (user_id, total_kills, max_kill_streak)
        VALUES (?, ?, ?)
      `).bind(userId, kills, killStreak || 0).run();
    } else {
      // 기존 기록 갱신
      const newStreak = Math.max(current.max_kill_streak || 0, killStreak || 0);
      await DB.prepare(`
        UPDATE rankings 
        SET total_kills = total_kills + ?, max_kill_streak = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).bind(kills, newStreak, userId).run();
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('[rankings/hunting] POST Error:', error);
    return Response.json({ success: false, error: 'Failed to update ranking' }, { status: 500 });
  }
};
