// POST /api/auth/reset-direct - 이메일+닉네임으로 직접 비밀번호 재설정
import { hashPassword, isValidEmail, isValidPassword } from '../../lib/auth';

interface Env {
    DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    
    try {
        const body = await context.request.json() as { 
            email?: string; 
            nickname?: string; 
            newPassword?: string;
        };
        const { email, nickname, newPassword } = body;
        
        if (!email || !isValidEmail(email)) {
            return Response.json({ error: '올바른 이메일을 입력해주세요' }, { status: 400 });
        }
        if (!nickname || nickname.trim().length < 2) {
            return Response.json({ error: '닉네임을 입력해주세요' }, { status: 400 });
        }
        if (!newPassword || !isValidPassword(newPassword)) {
            return Response.json({ error: '새 비밀번호는 8자 이상이어야 합니다' }, { status: 400 });
        }
        
        // 이메일 + 닉네임 둘 다 일치하는 유저 찾기
        const user = await DB.prepare(`
            SELECT id FROM users 
            WHERE email = ? AND nickname = ? AND password_hash IS NOT NULL
        `).bind(email.toLowerCase(), nickname.trim()).first<{ id: string }>();
        
        if (!user) {
            return Response.json({ error: '이메일 또는 닉네임이 일치하지 않습니다' }, { status: 400 });
        }
        
        // 비밀번호 변경
        const passwordHash = await hashPassword(newPassword);
        
        await DB.batch([
            DB.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
                .bind(passwordHash, user.id),
            // 기존 리프레시 토큰 무효화
            DB.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).bind(user.id)
        ]);
        
        return Response.json({
            success: true,
            message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.'
        });
        
    } catch (e) {
        console.error('Reset-direct error:', e);
        return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
    }
};
