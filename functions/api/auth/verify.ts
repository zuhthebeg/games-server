// GET /api/auth/verify?token=xxx - 이메일 인증
interface Env {
    DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const token = url.searchParams.get('token');
    
    if (!token) {
        return Response.json({ error: '토큰이 필요합니다' }, { status: 400 });
    }
    
    try {
        // Find token
        const emailToken = await DB.prepare(`
            SELECT user_id, type, expires_at FROM email_tokens WHERE token = ?
        `).bind(token).first<{ user_id: string; type: string; expires_at: number }>();
        
        if (!emailToken) {
            return Response.json({ error: '유효하지 않은 토큰입니다' }, { status: 400 });
        }
        
        if (emailToken.type !== 'verify') {
            return Response.json({ error: '잘못된 토큰 타입입니다' }, { status: 400 });
        }
        
        const now = Math.floor(Date.now() / 1000);
        if (emailToken.expires_at < now) {
            // Delete expired token
            await DB.prepare(`DELETE FROM email_tokens WHERE token = ?`).bind(token).run();
            return Response.json({ error: '토큰이 만료되었습니다. 다시 가입해주세요.' }, { status: 400 });
        }
        
        // Verify user email
        await DB.prepare(`
            UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?
        `).bind(emailToken.user_id).run();
        
        // Delete used token
        await DB.prepare(`DELETE FROM email_tokens WHERE token = ?`).bind(token).run();
        
        return Response.json({
            success: true,
            message: '이메일 인증이 완료되었습니다! 로그인해주세요.'
        });
        
    } catch (e) {
        console.error('Verify error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
