/**
 * GET /api/auth/me
 * 현재 사용자 정보
 */

import type { Env, DBUser } from '../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../types';

interface PagesContext {
    request: Request;
    env: Env;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;

    const tokenData = getUserFromRequest(request);
    if (!tokenData) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const user = await env.DB.prepare(
            'SELECT id, nickname, is_anonymous, created_at FROM users WHERE id = ?'
        ).bind(tokenData.userId).first<DBUser>();

        if (!user) {
            return errorResponse('User not found', 404);
        }

        // Update last seen
        await env.DB.prepare(
            'UPDATE users SET last_seen_at = ? WHERE id = ?'
        ).bind(new Date().toISOString(), user.id).run();

        return jsonResponse({
            id: user.id,
            nickname: user.nickname,
            isAnonymous: user.is_anonymous === 1,
        });
    } catch (error) {
        console.error('Get user error:', error);
        return errorResponse('Failed to get user', 500);
    }
};
