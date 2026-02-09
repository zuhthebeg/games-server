/**
 * POST /api/rooms/:id/destroy - 방 강제 삭제 (방장만 가능)
 */

import type { Env, DBRoom } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';

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
        // Get room
        const room = await env.DB.prepare(
            'SELECT * FROM rooms WHERE id = ?'
        ).bind(roomId).first<DBRoom>();

        if (!room) {
            return errorResponse('Room not found', 404);
        }

        // Only host can destroy room
        if (room.host_id !== user.userId) {
            return errorResponse('Only host can destroy room', 403);
        }

        // Delete all events
        await env.DB.prepare(
            'DELETE FROM events WHERE room_id = ?'
        ).bind(roomId).run();

        // Delete all players
        await env.DB.prepare(
            'DELETE FROM room_players WHERE room_id = ?'
        ).bind(roomId).run();

        // Delete room
        await env.DB.prepare(
            'DELETE FROM rooms WHERE id = ?'
        ).bind(roomId).run();

        return jsonResponse({ message: 'Room destroyed', roomId });
    } catch (error) {
        console.error('Destroy room error:', error);
        return errorResponse('Failed to destroy room', 500);
    }
};
