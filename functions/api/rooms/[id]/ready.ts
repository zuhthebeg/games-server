/**
 * POST /api/rooms/:id/ready - 준비 완료/취소
 * 
 * Body: { ready?: boolean, playerData?: any }
 * - playerData is optional game-specific data (e.g. weapon info for enhance game)
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
        const body = await request.json().catch(() => ({})) as { ready?: boolean; playerData?: any };

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

        // Update with optional playerData (stored in player_state)
        if (body.playerData !== undefined) {
            await env.DB.prepare(
                'UPDATE room_players SET is_ready = ?, player_state = ? WHERE room_id = ? AND user_id = ?'
            ).bind(newReady, JSON.stringify(body.playerData), roomId, user.userId).run();
        } else {
            await env.DB.prepare(
                'UPDATE room_players SET is_ready = ? WHERE room_id = ? AND user_id = ?'
            ).bind(newReady, roomId, user.userId).run();
        }

        // Add event
        await addEvent(env, roomId, 'player_ready', user.userId, { ready: newReady === 1, hasPlayerData: !!body.playerData });

        // Check if all players (except host) are ready - track all_ready_at
        const { results: allPlayers } = await env.DB.prepare(
            'SELECT user_id, is_ready FROM room_players WHERE room_id = ?'
        ).bind(roomId).all<{ user_id: string; is_ready: number }>();
        
        const hostId = room.host_id;
        const nonHostPlayers = allPlayers?.filter(p => p.user_id !== hostId) || [];
        const allNonHostReady = nonHostPlayers.length > 0 && nonHostPlayers.every(p => p.is_ready === 1);
        
        // Update room config with all_ready_at timestamp
        const config = room.config ? JSON.parse(room.config) : {};
        if (allNonHostReady && !config.all_ready_at) {
            config.all_ready_at = Date.now();
            await env.DB.prepare(
                'UPDATE rooms SET config = ? WHERE id = ?'
            ).bind(JSON.stringify(config), roomId).run();
        } else if (!allNonHostReady && config.all_ready_at) {
            delete config.all_ready_at;
            await env.DB.prepare(
                'UPDATE rooms SET config = ? WHERE id = ?'
            ).bind(JSON.stringify(config), roomId).run();
        }

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
