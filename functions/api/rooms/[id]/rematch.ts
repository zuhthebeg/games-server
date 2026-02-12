/**
 * POST /api/rooms/:id/rematch - 리매치 (게임 끝난 후 다시 시작 준비)
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

        // Check if game is finished (by status or by game state)
        let isFinished = room.status === 'finished';
        
        // Also check game state's gameOver flag (in case status wasn't updated)
        if (!isFinished && room.state) {
            try {
                const state = JSON.parse(room.state);
                isFinished = state.gameOver === true || state.winner !== null;
            } catch (e) {}
        }
        
        if (!isFinished) {
            return errorResponse('Game is not finished yet', 400);
        }
        
        // Update status to finished if it wasn't already
        if (room.status !== 'finished') {
            await env.DB.prepare(
                `UPDATE rooms SET status = 'finished', finished_at = ? WHERE id = ?`
            ).bind(new Date().toISOString(), roomId).run();
        }

        // Reset room status to waiting
        await env.DB.prepare(
            `UPDATE rooms SET status = 'waiting', state = NULL, started_at = NULL, finished_at = NULL WHERE id = ?`
        ).bind(roomId).run();

        // Reset all players' ready status
        await env.DB.prepare(
            `UPDATE room_players SET is_ready = 0, player_state = NULL WHERE room_id = ?`
        ).bind(roomId).run();

        // Add event
        await addEvent(env, roomId, 'rematch_ready', user.userId, {});

        return jsonResponse({ message: 'Room reset for rematch', status: 'waiting' });
    } catch (error) {
        console.error('Rematch error:', error);
        return errorResponse('Failed to setup rematch', 500);
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
