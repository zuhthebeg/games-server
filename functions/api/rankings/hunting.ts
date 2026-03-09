// GET/POST /api/rankings/hunting - 사냥 랭킹 조회/갱신
import type { D1Database } from '@cloudflare/workers-types';
import { upsertDailyScore } from './_rank_utils';

interface Env {
  DB: D1Database;
}

// 유저 존재 확인 및 생성/닉네임 업데이트
function sanitizeNickname(nickname?: string): string | null {
  if (!nickname) return null;
  const n = nickname.trim();
  if (!n) return null;
  // UTF-8 깨짐(mojibake) 패턴 차단
  if (/[ìëêãåæ]/.test(n)) return null;
  return n;
}

async function ensureUser(DB: D1Database, userId: string, nickname?: string) {
  const safeNick = sanitizeNickname(nickname);
  const existing = await DB.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(userId).first<{id: string, nickname: string}>();
  if (!existing) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)').bind(userId, safeNick || null).run();
  } else if (safeNick && safeNick !== existing.nickname) {
    await DB.prepare('UPDATE users SET nickname = ?, updated_at = datetime("now") WHERE id = ?').bind(safeNick, userId).run();
  }
}

async function ensureBossKillsColumn(DB: D1Database) {
  try {
    await DB.prepare('ALTER TABLE rankings ADD COLUMN boss_kills INTEGER DEFAULT 0').run();
  } catch {
    // 이미 컬럼이 있으면 무시
  }
}

// GET - 랭킹 조회
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const type = url.searchParams.get('type') || 'kills';

  try {
    await ensureBossKillsColumn(DB);

    const orderBy = type === 'streak' 
      ? 'r.max_kill_streak DESC' 
      : type === 'boss'
        ? 'r.boss_kills DESC'
        : 'r.total_kills DESC';

    const result = await DB.prepare(`
      SELECT 
        r.user_id,
        COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 4)) as nickname,
        r.total_kills,
        r.max_kill_streak,
        COALESCE(r.boss_kills, 0) as boss_kills
      FROM rankings r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE (r.total_kills > 0 OR COALESCE(r.boss_kills, 0) > 0)
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
  nickname?: string;
  kills: number;
  killStreak?: number;
  bossKills?: number;
}

// POST - 기록 갱신
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;

  try {
    const body: HuntingRecord = await context.request.json();
    const userId = body.userId || context.request.headers.get('x-user-id');
    const { nickname, kills, killStreak, bossKills } = body;

    if (!userId) {
      return Response.json({ success: false, error: 'Missing userId' }, { status: 400 });
    }

    if (typeof kills !== 'number' || kills < 0) {
      return Response.json({ success: false, error: 'Invalid kills count' }, { status: 400 });
    }

    // 유저 존재 확인 + 닉네임 업데이트
    await ensureUser(DB, userId, nickname);
    await ensureBossKillsColumn(DB);

    const current = await DB.prepare(
      'SELECT total_kills, max_kill_streak, COALESCE(boss_kills, 0) as boss_kills FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ total_kills: number; max_kill_streak: number; boss_kills: number }>();

    let newTotalKills = kills;
    if (!current) {
      await DB.prepare(`
        INSERT INTO rankings (user_id, total_kills, max_kill_streak, boss_kills)
        VALUES (?, ?, ?, ?)
      `).bind(userId, kills, killStreak || 0, bossKills || 0).run();
      newTotalKills = kills;
    } else {
      const newStreak = Math.max(current.max_kill_streak || 0, killStreak || 0);
      await DB.prepare(`
        UPDATE rankings 
        SET total_kills = total_kills + ?, max_kill_streak = ?, boss_kills = COALESCE(boss_kills, 0) + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).bind(kills, newStreak, bossKills || 0, userId).run();
      newTotalKills = (current.total_kills || 0) + kills;
    }

    await upsertDailyScore(DB, userId, 'hunt', newTotalKills);
    return Response.json({ success: true, totalKills: newTotalKills });
  } catch (error) {
    console.error('[rankings/hunting] POST Error:', error);
    return Response.json({ success: false, error: 'Failed to update ranking' }, { status: 500 });
  }
};
