// POST /api/auth/forgot - 비밀번호 재설정 요청
import { generateToken, isValidEmail } from '../../lib/auth';
import { sendEmail, resetPasswordTemplate } from '../../lib/email';

interface Env {
    DB: D1Database;
    RESEND_API_KEY: string;
    BASE_URL: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB, RESEND_API_KEY, BASE_URL } = context.env;
    
    try {
        const body = await context.request.json() as { email?: string };
        const { email } = body;
        
        if (!email || !isValidEmail(email)) {
            return Response.json({ error: '올바른 이메일을 입력해주세요' }, { status: 400 });
        }
        
        // Always return success to prevent email enumeration
        const successResponse = {
            success: true,
            message: '비밀번호 재설정 링크를 이메일로 발송했습니다.'
        };
        
        // Find user
        const user = await DB.prepare(`
            SELECT id, nickname FROM users WHERE email = ? AND password_hash IS NOT NULL
        `).bind(email.toLowerCase()).first<{ id: string; nickname: string }>();
        
        if (!user) {
            // Don't reveal whether email exists
            return Response.json(successResponse);
        }
        
        // Delete any existing reset tokens for this user
        await DB.prepare(`
            DELETE FROM email_tokens WHERE user_id = ? AND type = 'reset'
        `).bind(user.id).run();
        
        // Create reset token
        const resetToken = generateToken();
        const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        await DB.prepare(`
            INSERT INTO email_tokens (token, user_id, type, expires_at)
            VALUES (?, ?, 'reset', ?)
        `).bind(resetToken, user.id, expiresAt).run();
        
        // Send reset email
        const resetUrl = `${BASE_URL || 'https://cocy.io'}/reset-password?token=${resetToken}`;
        const { subject, html } = resetPasswordTemplate(user.nickname, resetUrl);
        await sendEmail(email, subject, html, { RESEND_API_KEY, DB });
        
        return Response.json(successResponse);
        
    } catch (e) {
        console.error('Forgot error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
