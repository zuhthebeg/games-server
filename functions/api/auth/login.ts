// POST /api/auth/login - 로그인
import { verifyPassword, createJWT, generateToken } from '../../lib/auth';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    
    try {
        const body = await context.request.json() as { email?: string; password?: string };
        const { email, password } = body;
        
        if (!email || !password) {
            return Response.json({ error: '이메일과 비밀번호를 입력해주세요' }, { status: 400 });
        }
        
        // Find user
        const user = await DB.prepare(`
            SELECT id, email, password_hash, nickname, email_verified, avatar_url, is_anonymous
            FROM users WHERE email = ?
        `).bind(email.toLowerCase()).first<{
            id: string;
            email: string;
            password_hash: string;
            nickname: string;
            email_verified: number;
            avatar_url: string | null;
            is_anonymous: number;
        }>();
        
        if (!user || !user.password_hash) {
            return Response.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
        }
        
        // Verify password
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return Response.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
        }
        
        // Update last login
        await DB.prepare(`
            UPDATE users SET last_seen_at = datetime('now') WHERE id = ?
        `).bind(user.id).run();
        
        // Create tokens
        const accessToken = await createJWT({
            sub: user.id,
            email: user.email,
            nickname: user.nickname,
            emailVerified: user.email_verified === 1
        }, JWT_SECRET, 900); // 15 minutes
        
        const refreshToken = generateToken(48);
        const refreshExpires = Math.floor(Date.now() / 1000) + 2592000; // 30 days
        
        await DB.prepare(`
            INSERT INTO refresh_tokens (token, user_id, expires_at)
            VALUES (?, ?, ?)
        `).bind(refreshToken, user.id, refreshExpires).run();
        
        return Response.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                nickname: user.nickname,
                emailVerified: user.email_verified === 1,
                avatarUrl: user.avatar_url
            }
        });
        
    } catch (e) {
        console.error('Login error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
