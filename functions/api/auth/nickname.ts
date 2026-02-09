// POST /api/auth/nickname - 익명 사용자 닉네임 설정
interface Env {
    DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    
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
        
        // Find user by token (anonymous token is the user id for anonymous users)
        const user = await DB.prepare(`
            SELECT id, nickname FROM users WHERE id = ?
        `).bind(token).first<{ id: string; nickname: string }>();
        
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
