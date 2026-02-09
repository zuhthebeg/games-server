/**
 * POST /api/rooms/:id/join - 방 입장
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

        if (room.status !== 'waiting') {
            return errorResponse('Game already started', 400);
        }

        // Check if already in room
        const existing = await env.DB.prepare(
            'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
        ).bind(roomId, user.userId).first<DBRoomPlayer>();

        if (existing) {
            return jsonResponse({ message: 'Already in room', seat: existing.seat });
        }

        // Count current players
        const { results: players } = await env.DB.prepare(
            'SELECT seat FROM room_players WHERE room_id = ? ORDER BY seat'
        ).bind(roomId).all<{ seat: number }>();

        if (players && players.length >= room.max_players) {
            return errorResponse('Room is full', 400);
        }

        // Find next available seat
        const takenSeats = new Set(players?.map(p => p.seat) || []);
        let seat = 0;
        while (takenSeats.has(seat)) seat++;

        // Join room
        const now = new Date().toISOString();
        await env.DB.prepare(
            'INSERT INTO room_players (room_id, user_id, seat, is_ready, joined_at) VALUES (?, ?, ?, 0, ?)'
        ).bind(roomId, user.userId, seat, now).run();

        // Add event
        await addEvent(env, roomId, 'player_joined', user.userId, { seat });

        return jsonResponse({ message: 'Joined room', seat });
    } catch (error) {
        console.error('Join room error:', error);
        return errorResponse('Failed to join room', 500);
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
