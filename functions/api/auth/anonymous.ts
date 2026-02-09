/**
 * POST /api/auth/anonymous
 * 익명 세션 생성
 */

import type { Env } from '../../types';
import { jsonResponse, errorResponse, generateId, createToken } from '../../types';

interface PagesContext {
    request: Request;
    env: Env;
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { env } = context;

    try {
        const userId = generateId();
        const now = new Date().toISOString();

        // Create anonymous user
        await env.DB.prepare(
            'INSERT INTO users (id, is_anonymous, created_at, last_seen_at) VALUES (?, 1, ?, ?)'
        ).bind(userId, now, now).run();

        // Generate token
        const token = createToken({ userId, isAnonymous: true });

        return jsonResponse({
            token,
            user: {
                id: userId,
                nickname: null,
                isAnonymous: true,
            },
        });
    } catch (error) {
        console.error('Anonymous auth error:', error);
        return errorResponse('Failed to create session', 500);
    }
};
