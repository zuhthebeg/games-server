// POST /api/auth/nickname - 닉네임 설정 (익명 + JWT 둘 다 지원)
import { verifyJWT } from '../../lib/auth';
import { parseToken } from '../../types';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    
    // Get token from Authorization header
    const authHeader = context.request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
        return Response.json({ error: '인증이 필요합니다' }, { status: 401 });
    }
    
    try {
        const body = await context.request.json() as { nickname?: string };
        const { nickname } = body;
        
        if (!nickname || nickname.length < 2 || nickname.length > 12) {
            return Response.json({ error: '닉네임은 2-12자여야 합니다' }, { status: 400 });
        }
        
        let userId: string | null = null;
        
        // 1. Try anonymous token format (unsigned JWT from createToken)
        const anonPayload = parseToken(token);
        if (anonPayload && anonPayload.userId) {
            userId = anonPayload.userId;
        } else {
            // 2. Try signed JWT (from login)
            const jwtPayload = await verifyJWT(token, JWT_SECRET);
            if (jwtPayload && jwtPayload.sub) {
                userId = jwtPayload.sub;
            }
        }
        
        if (!userId) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 401 });
        }
        
        // Find user
        const user = await DB.prepare(`
            SELECT id, nickname FROM users WHERE id = ?
        `).bind(userId).first<{ id: string; nickname: string }>();
        
        if (!user) {
            return Response.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 });
        }
        
        // Update nickname
        await DB.prepare(`
            UPDATE users SET nickname = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(nickname, user.id).run();
        
        return Response.json({
            success: true,
            user: {
                id: user.id,
                nickname: nickname
            }
        });
        
    } catch (e) {
        console.error('Nickname error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
