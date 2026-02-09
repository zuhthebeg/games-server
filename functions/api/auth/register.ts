/**
 * POST /api/auth/register
 * 닉네임 등록 (익명 → 등록 또는 새 등록)
 */

import type { Env } from '../../types';
import { jsonResponse, errorResponse, generateId, createToken, getUserFromRequest } from '../../types';

interface PagesContext {
    request: Request;
    env: Env;
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;

    try {
        const body = await request.json() as { nickname?: string };
        const nickname = body.nickname?.trim();

        if (!nickname || nickname.length < 2 || nickname.length > 20) {
            return errorResponse('닉네임은 2-20자여야 합니다', 400);
        }

        // Check for existing token (upgrade anonymous to registered)
        const existingUser = getUserFromRequest(request);
        const now = new Date().toISOString();

        let userId: string;

        if (existingUser && existingUser.isAnonymous) {
            // Upgrade anonymous user
            userId = existingUser.userId;
            await env.DB.prepare(
                'UPDATE users SET nickname = ?, is_anonymous = 0, last_seen_at = ? WHERE id = ?'
            ).bind(nickname, now, userId).run();
        } else {
            // Create new registered user
            userId = generateId();
            await env.DB.prepare(
                'INSERT INTO users (id, nickname, is_anonymous, created_at, last_seen_at) VALUES (?, ?, 0, ?, ?)'
            ).bind(userId, nickname, now, now).run();
        }

        // Generate new token
        const token = createToken({ userId, isAnonymous: false });

        return jsonResponse({
            token,
            user: {
                id: userId,
                nickname,
                isAnonymous: false,
            },
        });
    } catch (error) {
        console.error('Register error:', error);
        return errorResponse('Failed to register', 500);
    }
};
