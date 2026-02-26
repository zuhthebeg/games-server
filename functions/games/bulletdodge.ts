/**
 * Bullet Dodge Game Plugin
 *
 * 멀티플레이어 총알 피하기
 * - 서버에서 seed 발급 → 모든 클라이언트 동일한 총알 패턴
 * - 액션: position (ghost 위치), died (생존 시간)
 * - 마지막 생존자 또는 가장 오래 산 플레이어가 승리
 */

import type {
    GamePlugin, Player, GameAction,
    ValidationResult, ActionResult, GameResult, GameEvent,
} from './types';

interface BDPlayer {
    id: string;
    nickname: string;
    seat: number;
    alive: boolean;
    survivalTime: number | null;
    ghostX: number;
    ghostY: number;
}

interface BDState {
    seed: number;
    players: BDPlayer[];
    winner: string | null;
    finished: boolean;
}

export const bulletDodgePlugin: GamePlugin = {
    id: 'bulletdodge',
    name: '총알 피하기',
    minPlayers: 2,
    maxPlayers: 4,

    createInitialState(players: Player[], _config?: any): BDState {
        return {
            seed: Math.floor(Math.random() * 0xFFFFFF),
            players: players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                seat: p.seat,
                alive: true,
                survivalTime: null,
                ghostX: 180,
                ghostY: 550,
            })),
            winner: null,
            finished: false,
        };
    },

    validateAction(state: BDState, action: GameAction, playerId: string): ValidationResult {
        if (!['position', 'died'].includes(action.type)) {
            return { valid: false, error: 'Unknown action type' };
        }
        if (!state.players.find(p => p.id === playerId)) {
            return { valid: false, error: 'Player not in game' };
        }
        return { valid: true };
    },

    applyAction(state: BDState, action: GameAction, playerId: string): ActionResult {
        if (state.finished) return { newState: state, events: [] };

        const newState: BDState = JSON.parse(JSON.stringify(state));
        const player = newState.players.find(p => p.id === playerId)!;
        const events: GameEvent[] = [];

        if (action.type === 'position') {
            player.ghostX = action.payload?.x ?? player.ghostX;
            player.ghostY = action.payload?.y ?? player.ghostY;
            events.push({
                type: 'ghost_moved',
                playerId,
                payload: { x: player.ghostX, y: player.ghostY, nickname: player.nickname },
            });

        } else if (action.type === 'died' && player.alive) {
            player.alive = false;
            player.survivalTime = Math.max(0, parseFloat(action.payload?.survivalTime ?? '0'));
            events.push({
                type: 'player_died',
                playerId,
                payload: {
                    survivalTime: player.survivalTime,
                    nickname: player.nickname,
                    seat: player.seat,
                },
            });

            // 모두 죽으면 종료
            if (newState.players.every(p => !p.alive)) {
                const sorted = [...newState.players].sort(
                    (a, b) => (b.survivalTime ?? 0) - (a.survivalTime ?? 0),
                );
                newState.winner = sorted[0].id;
                newState.finished = true;
                // game_ended는 isGameOver → 시스템이 자동 발사
            }
        }

        return { newState, events };
    },

    getCurrentTurn(_state: BDState): string | null {
        return null; // 동시 액션 허용
    },

    isGameOver(state: BDState): boolean {
        return state.finished;
    },

    getResult(state: BDState): GameResult | null {
        if (!state.finished) return null;
        return {
            winnerId: state.winner ?? undefined,
            scores: Object.fromEntries(
                state.players.map(p => [p.id, p.survivalTime ?? 0]),
            ),
        };
    },

    getPublicState(state: BDState): BDState {
        return state;
    },

    getPlayerView(state: BDState, _playerId: string): BDState {
        return state;
    },
};
