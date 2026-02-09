/**
 * POST /api/rooms/:id/ready - 준비 완료/취소
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
        const body = await request.json().catch(() => ({})) as { ready?: boolean };

        // Get room
        const room = await env.DB.prepare(
            'SELECT * FROM rooms WHERE id = ?'
        ).bind(roomId).first<DBRoom>();

        if (!room) {
            return errorResponse('Room not found', 404);
        }

        if (room.status !== 'waiting') {
            return errorResponse('Game already started', 400);
        }

        // Check if in room
        const player = await env.DB.prepare(
            'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
        ).bind(roomId, user.userId).first<DBRoomPlayer>();

        if (!player) {
            return errorResponse('Not in this room', 400);
        }

        // Toggle or set ready status
        const newReady = body.ready !== undefined ? (body.ready ? 1 : 0) : (player.is_ready === 1 ? 0 : 1);

        await env.DB.prepare(
            'UPDATE room_players SET is_ready = ? WHERE room_id = ? AND user_id = ?'
        ).bind(newReady, roomId, user.userId).run();

        // Add event
        await addEvent(env, roomId, 'player_ready', user.userId, { ready: newReady === 1 });

        return jsonResponse({ ready: newReady === 1 });
    } catch (error) {
        console.error('Ready error:', error);
        return errorResponse('Failed to update ready status', 500);
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
