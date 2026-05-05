import type { Env } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';
import { touchPlayerPresence, markStalePlayers, PRESENCE_PING_MS, PRESENCE_STALE_MS } from '../../../lib/presence';

interface PagesContext {
    request: Request;
    env: Env;
    params: { id: string };
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { request, env, params } = context;
    const roomId = params.id;

    const user = getUserFromRequest(request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first<{ id: string }>();
        if (!room) return errorResponse('Room not found', 404);

        const presence = await touchPlayerPresence(env, roomId, user.userId);
        const staleMarked = await markStalePlayers(env, roomId);

        return jsonResponse({
            ok: true,
            rejoined: presence.rejoined,
            seat: presence.seat,
            staleMarked,
            pingMs: PRESENCE_PING_MS,
            staleMs: PRESENCE_STALE_MS,
        });
    } catch (error) {
        console.error('Presence error:', error);
        return errorResponse('Failed to update presence', 500);
    }
};
