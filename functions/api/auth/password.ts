/**
 * 로그인 상태에서 비밀번호 변경 (기존 비번 확인 필수)
 * POST /api/auth/password { oldPassword, newPassword }
 *
 * reset(이메일 토큰)/reset-direct(이메일+닉네임)와 달리, 이건 세션이 살아있는
 * 사용자용이라 서명 검증된 JWT만 받는다 — 익명 토큰(무서명)으로는 비번 개념이 없다.
 */
import { Env as BaseEnv, jsonResponse, errorResponse } from '../../types';
import { verifyJWT, verifyPassword, hashPassword, isValidPassword } from '../../lib/auth';

interface Env extends BaseEnv { JWT_SECRET: string; }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
    const auth = ctx.request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const payload = await verifyJWT(auth.slice(7), ctx.env.JWT_SECRET);
    if (!payload?.sub) return errorResponse('Unauthorized', 401);

    try {
        const body: any = await ctx.request.json();
        const oldPassword = String(body.oldPassword || '');
        const newPassword = String(body.newPassword || '');
        if (!isValidPassword(newPassword)) {
            return errorResponse('새 비밀번호는 8자 이상이어야 합니다', 400);
        }

        const row = await ctx.env.DB.prepare(
            'SELECT password_hash FROM users WHERE id = ?'
        ).bind(payload.sub).first<{ password_hash: string | null }>();
        if (!row) return errorResponse('user not found', 404);
        if (!row.password_hash) {
            // 구글 전용 계정 — 확인할 기존 비번이 없으니 여기서는 못 만든다
            return errorResponse('비밀번호가 설정되지 않은 계정입니다', 400);
        }
        if (!(await verifyPassword(oldPassword, row.password_hash))) {
            return errorResponse('기존 비밀번호가 일치하지 않습니다', 403);
        }

        const newHash = await hashPassword(newPassword);
        await ctx.env.DB.prepare(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(newHash, payload.sub).run();
        // 다른 기기 세션 무효화. 지금 기기도 refresh는 죽지만 15분짜리 access는 살아 있으니
        // 클라이언트는 응답 받고 재로그인시키는 게 맞다.
        await ctx.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?')
            .bind(payload.sub).run();

        return jsonResponse({ success: true, reLogin: true });
    } catch (e: any) {
        return errorResponse(e.message, 500);
    }
};
