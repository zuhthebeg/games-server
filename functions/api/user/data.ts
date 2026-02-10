/**
 * 유저 공유 데이터 API
 * GET /api/user/data - 데이터 조회
 * PUT /api/user/data - 데이터 저장
 */
import { Env, jsonResponse, errorResponse, getUserFromRequest } from '../../types';

interface UserData {
    gold: number;
    weapon?: any;
    mastery?: { attacks: number; kills: number };
    stats?: any;
    protectionScrolls?: number;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
    const user = getUserFromRequest(ctx.request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }
    
    // 익명 유저는 서버 저장 불가
    if (user.isAnonymous) {
        return jsonResponse({ error: 'anonymous_user', message: 'Login required for cloud sync' }, 400);
    }
    
    try {
        const row = await ctx.env.DB.prepare(
            'SELECT gold, data FROM user_data WHERE user_id = ?'
        ).bind(user.userId).first<{ gold: number; data: string | null }>();
        
        if (!row) {
            // 데이터 없으면 기본값 반환
            return jsonResponse({ gold: 0, data: null });
        }
        
        return jsonResponse({
            gold: row.gold,
            data: row.data ? JSON.parse(row.data) : null
        });
    } catch (e) {
        console.error('GET /api/user/data error:', e);
        return errorResponse('Database error', 500);
    }
};

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
    const user = getUserFromRequest(ctx.request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }
    
    // 익명 유저는 서버 저장 불가
    if (user.isAnonymous) {
        return jsonResponse({ error: 'anonymous_user', message: 'Login required for cloud sync' }, 400);
    }
    
    let body: UserData;
    try {
        body = await ctx.request.json();
    } catch {
        return errorResponse('Invalid JSON', 400);
    }
    
    const { gold, ...rest } = body;
    const dataJson = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
    
    try {
        await ctx.env.DB.prepare(`
            INSERT INTO user_data (user_id, gold, data, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                gold = excluded.gold,
                data = excluded.data,
                updated_at = excluded.updated_at
        `).bind(user.userId, gold ?? 0, dataJson).run();
        
        return jsonResponse({ ok: true });
    } catch (e) {
        console.error('PUT /api/user/data error:', e);
        return errorResponse('Database error', 500);
    }
};
