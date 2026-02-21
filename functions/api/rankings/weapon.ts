// POST /api/rankings/weapon - 무기 기록 갱신
import type { D1Database } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

interface WeaponRecord {
  userId: string;
  nickname?: string;
  level: number;
  name: string;
  grade: string;
  element?: string;
  image?: string;
}

// 유저 존재 확인 및 생성/닉네임 업데이트
async function ensureUser(DB: D1Database, userId: string, nickname?: string) {
  const existing = await DB.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(userId).first<{id: string, nickname: string}>();
  if (!existing) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)').bind(userId, nickname || null).run();
  } else if (nickname && nickname !== existing.nickname) {
    // 닉네임이 다르면 업데이트
    await DB.prepare('UPDATE users SET nickname = ?, updated_at = datetime("now") WHERE id = ?').bind(nickname, userId).run();
  }
}

async function ensureBestWeaponImageColumn(DB: D1Database) {
  try {
    await DB.prepare('ALTER TABLE rankings ADD COLUMN best_weapon_image TEXT').run();
  } catch {
    // 이미 있으면 무시
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;

  try {
    const body: WeaponRecord = await context.request.json();
    const userId = body.userId || context.request.headers.get('x-user-id');
    const { nickname, level, name, grade, element, image } = body;

    if (!userId) {
      return Response.json({ success: false, error: 'Missing userId' }, { status: 400 });
    }

    if (level === undefined || !name || !grade) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // 유저 존재 확인 + 닉네임 업데이트
    await ensureUser(DB, userId, nickname);
    await ensureBestWeaponImageColumn(DB);

    // 현재 기록 확인
    const current = await DB.prepare(
      'SELECT best_weapon_level FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ best_weapon_level: number }>();

    // 신기록인 경우만 갱신
    if (!current) {
      await DB.prepare(`
        INSERT INTO rankings (user_id, best_weapon_level, best_weapon_name, best_weapon_grade, best_weapon_element, best_weapon_image, best_weapon_achieved_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(userId, level, name, grade, element || null, image || null).run();

      return Response.json({ success: true, newRecord: true, level });
    } else if (level > current.best_weapon_level) {
      await DB.prepare(`
        UPDATE rankings 
        SET best_weapon_level = ?, best_weapon_name = ?, best_weapon_grade = ?, best_weapon_element = ?, best_weapon_image = ?, best_weapon_achieved_at = datetime('now'), updated_at = datetime('now')
        WHERE user_id = ?
      `).bind(level, name, grade, element || null, image || null, userId).run();

      return Response.json({ success: true, newRecord: true, level, previousBest: current.best_weapon_level });
    }

    return Response.json({ success: true, newRecord: false, currentBest: current.best_weapon_level });
  } catch (error) {
    console.error('[rankings/weapon] Error:', error);
    return Response.json({ success: false, error: 'Failed to update ranking' }, { status: 500 });
  }
};
