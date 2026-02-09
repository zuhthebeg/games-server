/**
 * POST /api/rooms/:id/leave - 방 퇴장
 */

import type { Env, DBRoom, DBRoomPlayer } from '../../../types';
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

        // Check if in room
        const player = await env.DB.prepare(
            'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
        ).bind(roomId, user.userId).first<DBRoomPlayer>();

        if (!player) {
            return errorResponse('Not in this room', 400);
        }

        // Remove player
        await env.DB.prepare(
            'DELETE FROM room_players WHERE room_id = ? AND user_id = ?'
        ).bind(roomId, user.userId).run();

        // Add event
        await addEvent(env, roomId, 'player_left', user.userId, { seat: player.seat });

        // If host left and game not started, assign new host or delete room
        if (room.host_id === user.userId && room.status === 'waiting') {
            const { results: remaining } = await env.DB.prepare(
                'SELECT user_id FROM room_players WHERE room_id = ? ORDER BY joined_at LIMIT 1'
            ).bind(roomId).all<{ user_id: string }>();

            if (remaining && remaining.length > 0) {
                // Assign new host
                await env.DB.prepare(
                    'UPDATE rooms SET host_id = ? WHERE id = ?'
                ).bind(remaining[0].user_id, roomId).run();

                await addEvent(env, roomId, 'host_changed', remaining[0].user_id, {});
            } else {
                // Delete empty room
                await env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId).run();
            }
        }

        return jsonResponse({ message: 'Left room' });
    } catch (error) {
        console.error('Leave room error:', error);
        return errorResponse('Failed to leave room', 500);
    }
};

async function addEvent(env: Env, roomId: string, type: string, userId: string | null, payload: any) {
    const { results } = await env.DB.prepare(
        'SELECT MAX(seq) as maxSeq FROM events WHERE room_id = ?'
    ).bind(roomId).all<{ maxSeq: number | null }>();

    const seq = (results?.[0]?.maxSeq || 0) + 1;

    await env.DB.prepare(
        'INSERT INTO events (room_id, seq, event_type, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(roomId, seq, type, userId, JSON.stringify(payload), new Date().toISOString()).run();
}
