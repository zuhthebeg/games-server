/**
 * Connect 4 - 3 Player (삼인 사목)
 * 4 in a row wins, 3 players
 */

import type { GamePlugin, GameAction, Player, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

interface Connect4State {
    board: (string | null)[][]; // 7 columns x 6 rows
    currentPlayerIndex: number;
    players: { id: string; nickname: string; color: string }[];
    winner: string | null;
    winLine: { row: number; col: number }[] | null;
    lastMove: { row: number; col: number } | null;
    eliminated: string[]; // players who can't move
}

const COLS = 7;
const ROWS = 6;
const WIN_COUNT = 4;
const COLORS = ['red', 'yellow', 'blue'];

export const connect4Plugin: GamePlugin = {
    id: 'connect4',
    name: '삼인 사목',
    minPlayers: 2,
    maxPlayers: 3,

    createInitialState(players: Player[], config?: any): Connect4State {
        // Create empty board
        const board: (string | null)[][] = [];
        for (let row = 0; row < ROWS; row++) {
            board.push(new Array(COLS).fill(null));
        }

        // Shuffle and assign colors
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        
        return {
            board,
            currentPlayerIndex: 0,
            players: shuffled.map((p, i) => ({
                id: p.id,
                nickname: p.nickname,
                color: COLORS[i]
            })),
            winner: null,
            winLine: null,
            lastMove: null,
            eliminated: []
        };
    },

    validateAction(state: Connect4State, action: GameAction, playerId: string): ValidationResult {
        if (state.winner) {
            return { valid: false, error: '게임이 이미 끝났습니다' };
        }

        const currentPlayer = state.players[state.currentPlayerIndex];
        if (currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 차례가 아닙니다' };
        }

        if (action.type !== 'place') {
            return { valid: false, error: '잘못된 액션입니다' };
        }

        const { row, col } = action.payload || {};
        if (row === undefined || col === undefined || row < 0 || row >= ROWS || col < 0 || col >= COLS) {
            return { valid: false, error: '잘못된 위치입니다' };
        }

        if (state.board[row][col] !== null) {
            return { valid: false, error: '이미 돌이 있는 위치입니다' };
        }

        return { valid: true };
    },

    applyAction(state: Connect4State, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as Connect4State;
        const { row, col } = action.payload;
        const events: GameEvent[] = [];

        // Place piece directly at the chosen cell
        newState.board[row][col] = playerId;
        newState.lastMove = { row, col };

        const player = newState.players.find(p => p.id === playerId);
        events.push({
            type: 'place',
            playerId,
            payload: { row, col, color: player?.color }
        });

        // Check for win
        const winLine = checkWin(newState.board, row, col, playerId);
        if (winLine) {
            newState.winner = playerId;
            newState.winLine = winLine;
            events.push({
                type: 'game_end',
                payload: { winner: playerId, winLine, reason: '4목 완성!' }
            });
        } else if (isBoardFull(newState.board)) {
            newState.winner = 'draw';
            events.push({
                type: 'game_end',
                payload: { winner: null, reason: '무승부' }
            });
        } else {
            // Next player (skip eliminated)
            let next = (newState.currentPlayerIndex + 1) % newState.players.length;
            let attempts = 0;
            while (newState.eliminated.includes(newState.players[next].id) && attempts < newState.players.length) {
                next = (next + 1) % newState.players.length;
                attempts++;
            }
            newState.currentPlayerIndex = next;
        }

        return { newState, events };
    },

    getCurrentTurn(state: Connect4State): string | null {
        if (state.winner) return null;
        return state.players[state.currentPlayerIndex].id;
    },

    isGameOver(state: Connect4State): boolean {
        return state.winner !== null;
    },

    getResult(state: Connect4State): GameResult | null {
        if (!state.winner) return null;
        
        if (state.winner === 'draw') {
            return { reason: '무승부' };
        }

        return {
            winnerId: state.winner,
            reason: '4목 완성!'
        };
    },

    getPublicState(state: Connect4State): any {
        return {
            board: state.board,
            currentPlayerIndex: state.currentPlayerIndex,
            players: state.players,
            winner: state.winner,
            winLine: state.winLine,
            lastMove: state.lastMove
        };
    },

    getPlayerView(state: Connect4State, playerId: string): any {
        const me = state.players.find(p => p.id === playerId);
        const current = state.players[state.currentPlayerIndex];
        return {
            myColor: me?.color,
            isMyTurn: current?.id === playerId && !state.winner
        };
    }
};

function checkWin(board: (string | null)[][], row: number, col: number, playerId: string): { row: number; col: number }[] | null {
    const directions = [
        [0, 1],   // horizontal
        [1, 0],   // vertical
        [1, 1],   // diagonal \
        [1, -1]   // diagonal /
    ];

    for (const [dr, dc] of directions) {
        const line: { row: number; col: number }[] = [{ row, col }];
        
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === playerId) {
                line.push({ row: r, col: c });
            } else {
                break;
            }
        }
        
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === playerId) {
                line.push({ row: r, col: c });
            } else {
                break;
            }
        }

        if (line.length >= WIN_COUNT) {
            return line;
        }
    }

    return null;
}

function isBoardFull(board: (string | null)[][]): boolean {
    return board[0].every(cell => cell !== null);
}
