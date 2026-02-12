// POST /api/rankings/weapon - 무기 기록 갱신
import type { D1Database } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

interface WeaponRecord {
  level: number;
  name: string;
  grade: string;
  element?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { DB } = context.env;
  
  // 인증 확인
  const userId = context.request.headers.get('x-user-id');
  if (!userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: WeaponRecord = await context.request.json();
    const { level, name, grade, element } = body;

    if (!level || !name || !grade) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // 현재 기록 확인
    const current = await DB.prepare(
      'SELECT best_weapon_level FROM rankings WHERE user_id = ?'
    ).bind(userId).first<{ best_weapon_level: number }>();

    // 신기록인 경우만 갱신
    if (!current) {
      // 새 레코드 생성
      await DB.prepare(`
        INSERT INTO rankings (user_id, best_weapon_level, best_weapon_name, best_weapon_grade, best_weapon_element, best_weapon_achieved_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(userId, level, name, grade, element || null).run();

      return Response.json({ success: true, newRecord: true, level });
    } else if (level > current.best_weapon_level) {
      // 기존 기록 갱신
      await DB.prepare(`
        UPDATE rankings 
        SET best_weapon_level = ?, best_weapon_name = ?, best_weapon_grade = ?, best_weapon_element = ?, best_weapon_achieved_at = datetime('now'), updated_at = datetime('now')
        WHERE user_id = ?
      `).bind(level, name, grade, element || null, userId).run();

      return Response.json({ success: true, newRecord: true, level, previousBest: current.best_weapon_level });
    }

    return Response.json({ success: true, newRecord: false, currentBest: current.best_weapon_level });
  } catch (error) {
    console.error('[rankings/weapon] Error:', error);
    return Response.json({ success: false, error: 'Failed to update ranking' }, { status: 500 });
  }
};
