// POST /api/auth/register - 이메일 가입
import { hashPassword, generateId, isValidEmail, isValidPassword, createJWT, generateToken } from '../../lib/auth';

interface Env {
    DB: D1Database;
    JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB, JWT_SECRET } = context.env;
    
    try {
        const body = await context.request.json() as { email?: string; password?: string; nickname?: string };
        const { email, password, nickname } = body;
        
        // Validation
        if (!email || !password) {
            return Response.json({ error: '이메일과 비밀번호를 입력해주세요' }, { status: 400 });
        }
        if (!isValidEmail(email)) {
            return Response.json({ error: '올바른 이메일 형식이 아닙니다' }, { status: 400 });
        }
        if (!isValidPassword(password)) {
            return Response.json({ error: '비밀번호는 8자 이상이어야 합니다' }, { status: 400 });
        }
        
        // Check if email already exists
        const existing = await DB.prepare(
            `SELECT id FROM users WHERE email = ?`
        ).bind(email.toLowerCase()).first();
        
        if (existing) {
            return Response.json({ error: '이미 가입된 이메일입니다' }, { status: 409 });
        }
        
        // Create user (auto-verified, no email verification for now)
        const userId = generateId();
        const passwordHash = await hashPassword(password);
        const displayName = nickname || email.split('@')[0];
        
        await DB.prepare(`
            INSERT INTO users (id, email, password_hash, nickname, is_anonymous, email_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 1, datetime('now'), datetime('now'))
        `).bind(userId, email.toLowerCase(), passwordHash, displayName).run();
        
        // Auto-login: create tokens
        const accessToken = await createJWT({
            sub: userId,
            email: email.toLowerCase(),
            nickname: displayName,
            emailVerified: true
        }, JWT_SECRET, 900); // 15 minutes
        
        const refreshToken = generateToken(48);
        const refreshExpires = Math.floor(Date.now() / 1000) + 2592000; // 30 days
        
        await DB.prepare(`
            INSERT INTO refresh_tokens (token, user_id, expires_at)
            VALUES (?, ?, ?)
        `).bind(refreshToken, userId, refreshExpires).run();
        
        return Response.json({
            success: true,
            message: '가입 완료!',
            accessToken,
            refreshToken,
            user: {
                id: userId,
                email: email.toLowerCase(),
                nickname: displayName,
                emailVerified: true
            }
        }, { status: 201 });
        
    } catch (e) {
        console.error('Register error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
