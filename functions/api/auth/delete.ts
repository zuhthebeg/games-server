/**
 * 회원 탈퇴 — 계정과 딸린 데이터를 전부 지운다.
 * POST /api/auth/delete { password? }
 *
 * 비번 계정은 비번 재확인을 요구한다(토큰 탈취만으로 계정을 지우는 걸 막는다).
 * 구글 전용 계정은 확인할 비번이 없으므로 서명 JWT 검증만으로 진행한다.
 * 게스트(익명 토큰)도 자기 계정 삭제는 허용한다.
 */
import { Env as BaseEnv, jsonResponse, errorResponse, getUserFromRequest, parseToken } from '../../types';
import { verifyJWT, verifyPassword } from '../../lib/auth';

interface Env extends BaseEnv { JWT_SECRET: string; }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
    const auth = ctx.request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const token = auth.slice(7);

    // 파괴적 작업이라 등록 계정은 반드시 서명 검증을 통과해야 한다.
    // (일반 데이터 라우트는 parseJWT로 payload만 보지만, 여기서는 안 된다.)
    let userId: string | null = null;
    let isAnonymous = false;
    const anon = parseToken(token);
    if (anon?.userId) { userId = anon.userId; isAnonymous = true; }
    else {
        const jwt = await verifyJWT(token, ctx.env.JWT_SECRET);
        if (jwt?.sub) userId = jwt.sub as string;
    }
    if (!userId) return errorResponse('Unauthorized', 401);

    try {
        const row = await ctx.env.DB.prepare(
            'SELECT password_hash FROM users WHERE id = ?'
        ).bind(userId).first<{ password_hash: string | null }>();
        if (!row) return errorResponse('user not found', 404);

        if (!isAnonymous && row.password_hash) {
            const body: any = await ctx.request.json().catch(() => ({}));
            const pw = String(body.password || '');
            if (!(await verifyPassword(pw, row.password_hash))) {
                return errorResponse('비밀번호가 일치하지 않습니다', 403);
            }
        }

        // 테이블별로 따로 지운다. 없는 테이블(런타임 생성 전)은 무시.
        const tables = [
            'refresh_tokens', 'user_data', 'user_traits',
            'voicematch_rankings', 'rankings', 'rank_daily',
            'rank_checkin', 'boss_encounters',
        ];
        for (const t of tables) {
            try { await ctx.env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId).run(); }
            catch { /* 테이블 없음 */ }
        }
        await ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

        return jsonResponse({ success: true });
    } catch (e: any) {
        return errorResponse(e.message, 500);
    }
};
