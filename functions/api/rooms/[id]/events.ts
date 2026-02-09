/**
 * GET /api/rooms/:id/events - 이벤트 폴링
 * Query params: after (seq number)
 */

import type { Env, DBEvent } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';

interface PagesContext {
    request: Request;
    env: Env;
    params: { id: string };
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
    const { request, env, params } = context;
    const roomId = params.id;

    const user = getUserFromRequest(request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const url = new URL(request.url);
        const after = parseInt(url.searchParams.get('after') || '0');

        // Get events after seq
        const { results: events } = await env.DB.prepare(
            `SELECT * FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT 100`
        ).bind(roomId, after).all<DBEvent>();

        return jsonResponse({
            events: events?.map(e => ({
                seq: e.seq,
                type: e.event_type,
                userId: e.user_id,
                payload: e.payload ? JSON.parse(e.payload) : null,
                createdAt: e.created_at,
            })) || [],
            lastSeq: events && events.length > 0 ? events[events.length - 1].seq : after,
        });
    } catch (error) {
        console.error('Get events error:', error);
        return errorResponse('Failed to get events', 500);
    }
};
