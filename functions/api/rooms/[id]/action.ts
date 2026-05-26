/**
 * POST /api/rooms/:id/action - 게임 액션 전송
 */

import type { Env, DBRoom, DBRoomPlayer } from '../../../types';
import { jsonResponse, errorResponse, getUserFromRequest } from '../../../types';
import { getGame } from '../../../games/registry';
import type { GameAction } from '../../../games/types';

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
        const action = await request.json() as GameAction;

        if (!action.type) {
            return errorResponse('Action type required', 400);
        }

        // Get room
        const room = await env.DB.prepare(
            'SELECT * FROM rooms WHERE id = ?'
        ).bind(roomId).first<DBRoom>();

        if (!room) {
            return errorResponse('Room not found', 404);
        }

        if (room.status !== 'playing') {
            return errorResponse('Game not in progress', 400);
        }

        // Check if player is in room
        const player = await env.DB.prepare(
            'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?'
        ).bind(roomId, user.userId).first<DBRoomPlayer>();

        if (!player) {
            return errorResponse('Not in this room', 400);
        }

        // Get game plugin
        const game = getGame(room.game_type);
        if (!game) {
            return errorResponse('Game plugin not found', 500);
        }

        // Parse current state
        const state = room.state ? JSON.parse(room.state) : null;
        if (!state) {
            return errorResponse('Game state not found', 500);
        }

        // Validate action
        const validation = game.validateAction(state, action, user.userId);
        if (!validation.valid) {
            return errorResponse(validation.error || 'Invalid action', 400);
        }

        // Apply action
        let { newState, events } = game.applyAction(state, action, user.userId);

        // Auto-execute AI turns (players with 'ai-' prefix ID) until a real player's turn
        try {
            let aiLoop = 0;
            const firstNextId = game.getCurrentTurn(newState);
            console.log(`[ai-turn] after human action: nextId=${firstNextId} gameOver=${game.isGameOver(newState)} players=${JSON.stringify((newState as any).players?.map((p: any) => p.id))}`);
            while (!game.isGameOver(newState) && aiLoop < 20) {
                const nextId = game.getCurrentTurn(newState);
                if (!nextId || !nextId.startsWith('ai-')) break;
                // Use plugin's AI action if available, otherwise default to PASS
                const aiAction = game.getAIAction?.(newState, nextId) ?? { type: 'PASS' };
                const aiValidation = game.validateAction(newState, aiAction, nextId);
                console.log(`[ai-turn] loop ${aiLoop}: playerId=${nextId} action=${aiAction.type} valid=${aiValidation.valid} err=${aiValidation.error}`);
                if (!aiValidation.valid) break;
                const aiResult = game.applyAction(newState, aiAction, nextId);
                newState = aiResult.newState;
                events = events.concat(aiResult.events);
                aiLoop++;
            }
            console.log(`[ai-turn] done: aiLoop=${aiLoop} finalTurn=${game.getCurrentTurn(newState)}`);
        } catch (aiErr) {
            console.error('[ai-turn] AI loop error:', aiErr);
        }

        // Check if game over
        const isGameOver = game.isGameOver(newState);
        const newStatus = isGameOver ? 'finished' : 'playing';

        // Update room state
        await env.DB.prepare(
            `UPDATE rooms SET state = ?, status = ?, finished_at = ? WHERE id = ?`
        ).bind(
            JSON.stringify(newState),
            newStatus,
            isGameOver ? new Date().toISOString() : null,
            roomId
        ).run();

        // Add action event
        await addEvent(env, roomId, 'action', user.userId, { action, events });

        // If game over, add result event
        if (isGameOver) {
            const result = game.getResult(newState);
            await addEvent(env, roomId, 'game_ended', null, { result });
        }

        return jsonResponse({
            success: true,
            gameState: game.getPublicState(newState),
            myView: game.getPlayerView(newState, user.userId),
            events,
            isGameOver,
            result: isGameOver ? game.getResult(newState) : null,
        });
    } catch (error) {
        console.error('Action error:', error);
        return errorResponse('Failed to process action', 500);
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
