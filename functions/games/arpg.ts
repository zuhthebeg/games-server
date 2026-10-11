// ARPG 2–4 player host-authoritative coop. Lobby/start only; RT carries inputs/snapshots.
import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult } from './types';

export const arpgPlugin: GamePlugin = {
    id: 'arpg',
    name: 'ARPG 협동 사냥',
    relay: true,
    minPlayers: 2,
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
