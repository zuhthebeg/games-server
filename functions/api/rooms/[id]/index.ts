/**
 * GET /api/rooms/:id - 방 상태 조회
 */

import type { Env, DBRoom, DBRoomPlayer, DBUser } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';
import { getGame } from '../../../games/registry';

interface PagesContext {
    request: Request;
    env: Env;
    params: { id: string };
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
    const { request, env, params } = context;
    const roomId = params.id;

    const user = getUserFromRequest(request);

    try {
        // Get room
        const room = await env.DB.prepare(
            'SELECT * FROM rooms WHERE id = ?'
        ).bind(roomId).first<DBRoom>();

        if (!room) {
            return errorResponse('Room not found', 404);
        }

        // Get players
        const { results: players } = await env.DB.prepare(
            `SELECT rp.*, u.nickname FROM room_players rp
             JOIN users u ON rp.user_id = u.id
             WHERE rp.room_id = ?
             ORDER BY rp.seat`
        ).bind(roomId).all<DBRoomPlayer & { nickname: string }>();

        // Get game plugin for state view
        const game = getGame(room.game_type);
        let gameState = null;
        let myView = null;

        if (room.state && game) {
            const state = JSON.parse(room.state);
            gameState = game.getPublicState(state);

            if (user) {
                myView = game.getPlayerView(state, user.userId);
            }
        }

        return jsonResponse({
            id: room.id,
            gameType: room.game_type,
            status: room.status,
            hostId: room.host_id,
            maxPlayers: room.max_players,
            config: room.config ? JSON.parse(room.config) : {},
            createdAt: room.created_at,
            startedAt: room.started_at,
            players: players?.map(p => ({
                id: p.user_id,
                nickname: p.nickname || `Player ${p.seat + 1}`,
                seat: p.seat,
                isReady: p.is_ready === 1,
                isHost: p.user_id === room.host_id,
            })) || [],
            gameState,
            myView,
        });
    } catch (error) {
        console.error('Get room error:', error);
        return errorResponse('Failed to get room', 500);
    }
};
