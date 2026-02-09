/**
 * POST /api/match/random - 랜덤 방 참가
 * 공개 방 중 자리 있는 곳에 자동 입장
 */

import type { Env, DBRoom, DBRoomPlayer } from '../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../types';

interface PagesContext {
    request: Request;
    env: Env;
}

interface RoomWithCount extends DBRoom {
    player_count: number;
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;

    const user = getUserFromRequest(request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const body = await request.json().catch(() => ({})) as { gameType?: string };
        const gameType = body.gameType || 'poker';

        // Find public rooms with space
        const { results: rooms } = await env.DB.prepare(
            `SELECT r.*, COUNT(rp.user_id) as player_count 
             FROM rooms r 
             LEFT JOIN room_players rp ON r.id = rp.room_id 
             WHERE r.status = 'waiting' 
               AND r.game_type = ?
               AND r.config LIKE '%"isPublic":true%'
             GROUP BY r.id 
             HAVING player_count < r.max_players
             ORDER BY r.created_at ASC
             LIMIT 10`
        ).bind(gameType).all<RoomWithCount>();

        if (!rooms || rooms.length === 0) {
            return errorResponse('현재 참가 가능한 공개 방이 없습니다', 404);
        }

        // Try to join the first available room
        for (const room of rooms) {
            // Check if already in this room
            const existing = await env.DB.prepare(
                'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
            ).bind(room.id, user.userId).first<DBRoomPlayer>();

            if (existing) {
                // Already in this room
                return jsonResponse({ 
                    roomId: room.id, 
                    message: 'Already in this room',
                    alreadyJoined: true 
                });
            }

            // Get current player count
            const { results: players } = await env.DB.prepare(
                'SELECT seat FROM room_players WHERE room_id = ? ORDER BY seat'
            ).bind(room.id).all<{ seat: number }>();

            if (players && players.length >= room.max_players) {
                continue; // Room is full, try next
            }

            // Find next available seat
            const takenSeats = new Set(players?.map(p => p.seat) || []);
            let seat = 0;
            while (takenSeats.has(seat)) seat++;

            // Join room
            const now = new Date().toISOString();
            await env.DB.prepare(
                'INSERT INTO room_players (room_id, user_id, seat, is_ready, joined_at) VALUES (?, ?, ?, 0, ?)'
            ).bind(room.id, user.userId, seat, now).run();

            // Add event
            await addEvent(env, room.id, 'player_joined', user.userId, { seat, random: true });

            return jsonResponse({ 
                roomId: room.id, 
                seat,
                message: 'Joined random room'
            });
        }

        return errorResponse('모든 방이 가득 찼습니다', 404);
    } catch (error) {
        console.error('Random match error:', error);
        return errorResponse('Failed to find random match', 500);
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
