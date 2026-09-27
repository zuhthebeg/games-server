// 감자특공대(spudsquad) — 브로테이토류 실시간 협동 웨이브 서바이벌.
// host-authoritative relay: 시뮬레이션은 호스트 클라가 돌리고, 고빈도 위치/스냅샷은 DO의 휘발성 'rt' 경로,
// 상점 구매·웨이브 전환·종료(__final) 같은 확정 이벤트만 action 경로로 흐른다. DO는 룰을 실행하지 않는다.
import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult } from './types';

export const spudsquadPlugin: GamePlugin = {
    id: 'spudsquad',
    name: '감자특공대',
    relay: true,
    minPlayers: 1,
    maxPlayers: 4,

    createInitialState(players: Player[]): any {
        return { players: players.map((p) => ({ id: p.id, nickname: p.nickname })), finished: false };
    },

    validateAction(): ValidationResult {
        return { valid: true };
    },

    applyAction(state: any, action: GameAction, playerId: string): ActionResult {
        return { newState: state, events: [{ type: action.type, playerId, payload: action.payload || {} }] };
    },

    getCurrentTurn(): string | null {
        return null;
    },

    isGameOver(state: any): boolean {
        return !!state?.finished;
    },

    getResult(state: any): any {
        return state?.finished ? { reason: "finished" } : null;
    },

    getPublicState(state: any): any {
        return state;
    },

    getPlayerView(state: any): any {
        return state;
    },
} as GamePlugin;
