/**
 * Echo Game Plugin - 테스트용 간단한 게임
 * 
 * 규칙: 플레이어가 번갈아가며 숫자를 입력
 * 10에 먼저 도달하면 승리
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

interface EchoState {
    players: Array<{
        id: string;
        nickname: string;
        seat: number;
        score: number;
    }>;
    currentTurn: number;  // seat index
    targetScore: number;
    history: Array<{ playerId: string; value: number }>;
}

export const echoPlugin: GamePlugin = {
    id: 'echo',
    name: '숫자 카운팅',
    minPlayers: 2,
    maxPlayers: 4,

    createInitialState(players: Player[], config?: any): EchoState {
        return {
            players: players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                seat: p.seat,
                score: 0,
            })),
            currentTurn: 0,
            targetScore: config?.targetScore || 10,
            history: [],
        };
    },

    validateAction(state: EchoState, action: GameAction, playerId: string): ValidationResult {
        // Check turn
        const currentPlayer = state.players[state.currentTurn];
        if (currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 턴이 아닙니다' };
        }

        // Check action type
        if (action.type !== 'add') {
            return { valid: false, error: '유효하지 않은 액션' };
        }

        // Check value
        const value = action.payload?.value;
        if (typeof value !== 'number' || value < 1 || value > 3) {
            return { valid: false, error: '1-3 사이의 숫자만 가능합니다' };
        }

        return { valid: true };
    },

    applyAction(state: EchoState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as EchoState;
        const value = action.payload?.value as number;

        // Update score
        const player = newState.players.find(p => p.id === playerId)!;
        player.score += value;

        // Record history
        newState.history.push({ playerId, value });

        // Next turn
        newState.currentTurn = (newState.currentTurn + 1) % newState.players.length;

        const events: GameEvent[] = [{
            type: 'score_updated',
            playerId,
            payload: { value, newScore: player.score },
        }];

        return { newState, events };
    },

    getCurrentTurn(state: EchoState): string | null {
        return state.players[state.currentTurn]?.id || null;
    },

    isGameOver(state: EchoState): boolean {
        return state.players.some(p => p.score >= state.targetScore);
    },

    getResult(state: EchoState): GameResult | null {
        const winner = state.players.find(p => p.score >= state.targetScore);
        if (!winner) return null;

        return {
            winnerId: winner.id,
            scores: Object.fromEntries(state.players.map(p => [p.id, p.score])),
            reason: `${winner.nickname}이(가) ${state.targetScore}점에 도달!`,
        };
    },

    getPublicState(state: EchoState): any {
        return {
            players: state.players,
            currentTurn: state.currentTurn,
            targetScore: state.targetScore,
            historyLength: state.history.length,
        };
    },

    getPlayerView(state: EchoState, playerId: string): any {
        return {
            ...this.getPublicState(state),
            isMyTurn: state.players[state.currentTurn]?.id === playerId,
            recentHistory: state.history.slice(-5),
        };
    },
};
