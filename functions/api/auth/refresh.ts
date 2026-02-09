// POST /api/auth/refresh - 토큰 갱신
import { createJWT, generateToken } from '../../lib/auth';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    
    try {
        const body = await context.request.json() as { refreshToken?: string };
        const { refreshToken } = body;
        
        if (!refreshToken) {
            return Response.json({ error: '리프레시 토큰이 필요합니다' }, { status: 400 });
        }
        
        // Find token
        const tokenData = await DB.prepare(`
            SELECT user_id, expires_at FROM refresh_tokens WHERE token = ?
        `).bind(refreshToken).first<{ user_id: string; expires_at: number }>();
        
        if (!tokenData) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 401 });
        }
        
        const now = Math.floor(Date.now() / 1000);
        if (tokenData.expires_at < now) {
            await DB.prepare(`DELETE FROM refresh_tokens WHERE token = ?`).bind(refreshToken).run();
            return Response.json({ error: '토큰이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 });
        }
        
        // Get user
        const user = await DB.prepare(`
            SELECT id, email, nickname, email_verified FROM users WHERE id = ?
        `).bind(tokenData.user_id).first<{
            id: string;
            email: string;
            nickname: string;
            email_verified: number;
        }>();
        
        if (!user) {
            return Response.json({ error: '사용자를 찾을 수 없습니다' }, { status: 401 });
        }
        
        // Create new access token
        const accessToken = await createJWT({
            sub: user.id,
            email: user.email,
            nickname: user.nickname,
            emailVerified: user.email_verified === 1
        }, JWT_SECRET, 900); // 15 minutes
        
        // Optionally rotate refresh token
        const newRefreshToken = generateToken(48);
        const refreshExpires = Math.floor(Date.now() / 1000) + 2592000; // 30 days
        
        await DB.batch([
            DB.prepare(`DELETE FROM refresh_tokens WHERE token = ?`).bind(refreshToken),
            DB.prepare(`INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)`)
                .bind(newRefreshToken, user.id, refreshExpires)
        ]);
        
        return Response.json({
            accessToken,
            refreshToken: newRefreshToken
        });
        
    } catch (e) {
        console.error('Refresh error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
