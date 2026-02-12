/**
 * POST /api/rooms - 방 생성
 * GET /api/rooms - 방 목록 (선택적)
 */

import type { Env, DBRoom } from '../../types';
import { jsonResponse, errorResponse, getUserFromRequest, generateRoomCode } from '../../types';
import { getGame, hasGame, listGames } from '../../games/registry';

interface PagesContext {
    request: Request;
    env: Env;
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;

    const user = getUserFromRequest(request);
    if (!user) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        const body = await request.json() as { gameType: string; config?: any; maxPlayers?: number; isPublic?: boolean; playerState?: any };
        const { gameType, config, maxPlayers, isPublic, playerState } = body;

        // Validate game type
        if (!hasGame(gameType)) {
            return errorResponse(`Unknown game type: ${gameType}. Available: ${listGames().map(g => g.id).join(', ')}`, 400);
        }

        const game = getGame(gameType)!;
        const effectiveMaxPlayers = Math.min(maxPlayers || game.maxPlayers, game.maxPlayers);

        // Generate unique room code
        let roomId: string;
        let attempts = 0;
        do {
            roomId = generateRoomCode();
            const existing = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first();
            if (!existing) break;
            attempts++;
        } while (attempts < 10);

        if (attempts >= 10) {
            return errorResponse('Failed to generate room code', 500);
        }

        const now = new Date().toISOString();
        const roomConfig = { ...(config || {}), isPublic: isPublic === true };

        // Create room
        await env.DB.prepare(
            `INSERT INTO rooms (id, game_type, status, host_id, config, max_players, created_at)
             VALUES (?, ?, 'waiting', ?, ?, ?, ?)`
        ).bind(roomId, gameType, user.userId, JSON.stringify(roomConfig), effectiveMaxPlayers, now).run();

        // Add host as first player with optional player state (weapon, gold, etc.)
        const playerStateJson = playerState ? JSON.stringify(playerState) : null;
        await env.DB.prepare(
            `INSERT INTO room_players (room_id, user_id, seat, is_ready, joined_at, player_state)
             VALUES (?, ?, 0, 0, ?, ?)`
        ).bind(roomId, user.userId, now, playerStateJson).run();

        return jsonResponse({
            roomId,
            gameType,
            maxPlayers: effectiveMaxPlayers,
            status: 'waiting',
        }, 201);
    } catch (error) {
        console.error('Create room error:', error);
        return errorResponse('Failed to create room', 500);
    }
};

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;

    const url = new URL(request.url);
    const gameType = url.searchParams.get('gameType');
    const status = url.searchParams.get('status') || 'waiting';

    try {
        let query = 'SELECT r.*, COUNT(rp.user_id) as player_count FROM rooms r LEFT JOIN room_players rp ON r.id = rp.room_id WHERE r.status = ?';
        const params: any[] = [status];

        if (gameType) {
            query += ' AND r.game_type = ?';
            params.push(gameType);
        }

        query += ' GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50';

        const { results } = await env.DB.prepare(query).bind(...params).all<DBRoom & { player_count: number }>();

        return jsonResponse(results?.map(r => ({
            id: r.id,
            gameType: r.game_type,
            status: r.status,
            playerCount: r.player_count,
            maxPlayers: r.max_players,
            createdAt: r.created_at,
        })) || []);
    } catch (error) {
        console.error('List rooms error:', error);
        return errorResponse('Failed to list rooms', 500);
    }
};
