/**
 * POST /api/rooms/:id/start - 게임 시작 (방장만)
 */

import type { Env, DBRoom, DBRoomPlayer } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';
import { getGame } from '../../../games/registry';
import type { Player } from '../../../games/types';

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

        if (room.host_id !== user.userId) {
            return errorResponse('Only host can start the game', 403);
        }

        if (room.status !== 'waiting') {
            return errorResponse('Game already started', 400);
        }

        // Get players
        const { results: dbPlayers } = await env.DB.prepare(
            `SELECT rp.*, u.nickname FROM room_players rp
             JOIN users u ON rp.user_id = u.id
             WHERE rp.room_id = ?
             ORDER BY rp.seat`
        ).bind(roomId).all<DBRoomPlayer & { nickname: string }>();

        if (!dbPlayers || dbPlayers.length < 2) {
            return errorResponse('Need at least 2 players', 400);
        }

        // Check all ready (except host)
        const notReady = dbPlayers.filter(p => p.user_id !== room.host_id && p.is_ready !== 1);
        if (notReady.length > 0) {
            return errorResponse('Not all players are ready', 400);
        }

        // Get game plugin
        const game = getGame(room.game_type);
        if (!game) {
            return errorResponse('Game plugin not found', 500);
        }

        if (dbPlayers.length < game.minPlayers) {
            return errorResponse(`Need at least ${game.minPlayers} players`, 400);
        }

        // Create initial state
        console.log('[start.ts] dbPlayers:', dbPlayers.map(p => ({ id: p.user_id, nickname: p.nickname, seat: p.seat })));
        const players: Player[] = dbPlayers.map(p => ({
            id: p.user_id,
            nickname: p.nickname || `Player ${p.seat + 1}`,
            seat: p.seat,
        }));
        console.log('[start.ts] Created players:', players);

        // Merge room config with player data
        const config = room.config ? JSON.parse(room.config) : {};
        
        // Extract player-specific data (weapons, gold, etc.) from player_state
        const playerData: Record<string, any> = {};
        for (const p of dbPlayers) {
            if (p.player_state) {
                try {
                    playerData[p.user_id] = JSON.parse(p.player_state);
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }
        
        // Add player data to config for game plugins
        // For enhance game: config.weapons[playerId], config.gold[playerId]
        if (Object.keys(playerData).length > 0) {
            config.playerData = playerData;
            
            // Convenience accessors for enhance game
            config.weapons = {};
            config.gold = {};
            for (const [playerId, data] of Object.entries(playerData)) {
                if ((data as any).weapon) {
                    config.weapons[playerId] = (data as any).weapon;
                }
                if ((data as any).gold !== undefined) {
                    config.gold[playerId] = (data as any).gold;
                }
            }
        }
        
        const initialState = game.createInitialState(players, config);

        const now = new Date().toISOString();

        // Update room
        await env.DB.prepare(
            `UPDATE rooms SET status = 'playing', state = ?, started_at = ? WHERE id = ?`
        ).bind(JSON.stringify(initialState), now, roomId).run();

        // Add event
        await addEvent(env, roomId, 'game_started', null, { playerCount: players.length });

        return jsonResponse({
            message: 'Game started',
            gameState: game.getPublicState(initialState),
        });
    } catch (error) {
        console.error('Start game error:', error);
        return errorResponse('Failed to start game', 500);
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
