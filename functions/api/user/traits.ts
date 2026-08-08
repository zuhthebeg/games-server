/**
 * 유저 특성(trait) 저장소 — 서비스별 "내 결과"를 한 테이블에 쌓는다.
 * 얼굴상/보이스매치/MBTI/음식월드컵처럼 서비스가 계속 늘어나는 구조라,
 * 서비스마다 테이블을 파는 대신 (user_id, trait) → JSON value 한 장으로 받는다.
 *
 * GET  /api/user/traits          - 내 특성 전부
 * POST /api/user/traits          - { trait, value } 저장(덮어쓰기)
 */
import { Env, jsonResponse, errorResponse, getUserFromRequest } from '../../types';

// 클라이언트가 아무 키나 쌓지 못하게 허용 목록으로 막는다. 새 서비스 = 여기에 한 줄.
const ALLOWED_TRAITS = ['animalface', 'voicematch', 'mbti', 'food_worldcup'];
const MAX_VALUE_LEN = 2000;

export async function ensureTraitsTable(db: D1Database) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_traits (
        user_id TEXT NOT NULL,
        trait TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, trait)
    )`).run();
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
    const user = getUserFromRequest(ctx.request);
    if (!user) return errorResponse('Unauthorized', 401);
    try {
        await ensureTraitsTable(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(
            'SELECT trait, value, updated_at FROM user_traits WHERE user_id = ?'
        ).bind(user.userId).all();
        const traits: Record<string, any> = {};
        for (const r of (rows.results || []) as any[]) {
            try { traits[r.trait] = { value: JSON.parse(r.value), updated_at: r.updated_at }; }
            catch { /* 깨진 JSON은 건너뛴다 */ }
        }
        return jsonResponse({ success: true, traits });
    } catch (e: any) {
        return errorResponse(e.message, 500);
    }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
    const user = getUserFromRequest(ctx.request);
    if (!user) return errorResponse('Unauthorized', 401);
    try {
        const body: any = await ctx.request.json();
        const trait = String(body.trait || '');
        if (!ALLOWED_TRAITS.includes(trait)) return errorResponse('unknown trait', 400);
        const value = JSON.stringify(body.value ?? null);
        if (value.length > MAX_VALUE_LEN) return errorResponse('value too large', 400);
        await ensureTraitsTable(ctx.env.DB);
        await ctx.env.DB.prepare(`
            INSERT INTO user_traits (user_id, trait, value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, trait) DO UPDATE SET
                value = excluded.value, updated_at = datetime('now')
        `).bind(user.userId, trait, value).run();
        return jsonResponse({ success: true });
    } catch (e: any) {
        return errorResponse(e.message, 500);
    }
};
