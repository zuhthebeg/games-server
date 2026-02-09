// GET/PATCH /api/auth/me - 내 정보 조회/수정
import { verifyJWT, extractBearerToken } from '../../lib/auth';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    const authHeader = context.request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    
    if (!token) {
        return Response.json({ error: '인증이 필요합니다' }, { status: 401 });
    }
    
    try {
        const payload = await verifyJWT(token, JWT_SECRET);
        if (!payload) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 401 });
        }
        
        const user = await DB.prepare(`
            SELECT id, email, nickname, email_verified, avatar_url, google_id, created_at
            FROM users WHERE id = ?
        `).bind(payload.sub).first<{
            id: string;
            email: string;
            nickname: string;
            email_verified: number;
            avatar_url: string | null;
            google_id: string | null;
            created_at: string;
        }>();
        
        if (!user) {
            return Response.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 });
        }
        
        return Response.json({
            id: user.id,
            email: user.email,
            nickname: user.nickname,
            emailVerified: user.email_verified === 1,
            avatarUrl: user.avatar_url,
            hasGoogleLinked: !!user.google_id,
            createdAt: user.created_at
        });
        
    } catch (e) {
        console.error('Me GET error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    const authHeader = context.request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    
    if (!token) {
        return Response.json({ error: '인증이 필요합니다' }, { status: 401 });
    }
    
    try {
        const payload = await verifyJWT(token, JWT_SECRET);
        if (!payload) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 401 });
        }
        
        const body = await context.request.json() as { nickname?: string; avatarUrl?: string };
        const updates: string[] = [];
        const values: any[] = [];
        
        if (body.nickname !== undefined) {
            if (body.nickname.length < 2 || body.nickname.length > 20) {
                return Response.json({ error: '닉네임은 2-20자여야 합니다' }, { status: 400 });
            }
            updates.push('nickname = ?');
            values.push(body.nickname);
        }
        
        if (body.avatarUrl !== undefined) {
            updates.push('avatar_url = ?');
            values.push(body.avatarUrl || null);
        }
        
        if (updates.length === 0) {
            return Response.json({ error: '수정할 내용이 없습니다' }, { status: 400 });
        }
        
        updates.push("updated_at = datetime('now')");
        values.push(payload.sub);
        
        await DB.prepare(`
            UPDATE users SET ${updates.join(', ')} WHERE id = ?
        `).bind(...values).run();
        
        return Response.json({ success: true, message: '프로필이 수정되었습니다' });
        
    } catch (e) {
        console.error('Me PATCH error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
