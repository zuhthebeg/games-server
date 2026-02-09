// POST /api/auth/reset - 비밀번호 재설정
import { hashPassword, isValidPassword } from '../../lib/auth';

interface Env {
    DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    
    try {
        const body = await context.request.json() as { token?: string; password?: string };
        const { token, password } = body;
        
        if (!token) {
            return Response.json({ error: '토큰이 필요합니다' }, { status: 400 });
        }
        
        if (!password || !isValidPassword(password)) {
            return Response.json({ error: '비밀번호는 8자 이상이어야 합니다' }, { status: 400 });
        }
        
        // Find token
        const emailToken = await DB.prepare(`
            SELECT user_id, expires_at FROM email_tokens WHERE token = ? AND type = 'reset'
        `).bind(token).first<{ user_id: string; expires_at: number }>();
        
        if (!emailToken) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 400 });
        }
        
        const now = Math.floor(Date.now() / 1000);
        if (emailToken.expires_at < now) {
            await DB.prepare(`DELETE FROM email_tokens WHERE token = ?`).bind(token).run();
            return Response.json({ error: '토큰이 만료되었습니다. 다시 요청해주세요.' }, { status: 400 });
        }
        
        // Update password
        const passwordHash = await hashPassword(password);
        
        await DB.batch([
            DB.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
                .bind(passwordHash, emailToken.user_id),
            DB.prepare(`DELETE FROM email_tokens WHERE token = ?`).bind(token),
            // Invalidate all refresh tokens for security
            DB.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).bind(emailToken.user_id)
        ]);
        
        return Response.json({
            success: true,
            message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.'
        });
        
    } catch (e) {
        console.error('Reset error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
