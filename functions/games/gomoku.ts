/**
 * Gomoku (오목) Game Plugin
 * 5 in a row wins
 */

import type { GamePlugin, GameAction, Player, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

interface GomokuState {
    board: (string | null)[][]; // 15x15 board, null = empty, otherwise playerId
    currentPlayer: string;
    players: { id: string; nickname: string; color: 'black' | 'white' }[];
    winner: string | null;
    winLine: { row: number; col: number }[] | null;
    lastMove: { row: number; col: number } | null;
    moveCount: number;
}

const BOARD_SIZE = 15;
const WIN_COUNT = 5;

export const gomokuPlugin: GamePlugin = {
    id: 'gomoku',
    name: '오목',
    minPlayers: 2,
    maxPlayers: 2,

    createInitialState(players: Player[], config?: any): GomokuState {
        // Create empty board
        const board: (string | null)[][] = [];
        for (let i = 0; i < BOARD_SIZE; i++) {
            board.push(new Array(BOARD_SIZE).fill(null));
        }

        // Randomly assign colors (black goes first)
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        
        return {
            board,
            currentPlayer: shuffled[0].id, // Black goes first
            players: [
                { id: shuffled[0].id, nickname: shuffled[0].nickname, color: 'black' },
                { id: shuffled[1].id, nickname: shuffled[1].nickname, color: 'white' }
            ],
            winner: null,
            winLine: null,
            lastMove: null,
            moveCount: 0
        };
    },

    validateAction(state: GomokuState, action: GameAction, playerId: string): ValidationResult {
        if (state.winner) {
            return { valid: false, error: '게임이 이미 끝났습니다' };
        }

        if (state.currentPlayer !== playerId) {
            return { valid: false, error: '당신의 차례가 아닙니다' };
        }

        if (action.type !== 'place') {
            return { valid: false, error: '잘못된 액션입니다' };
        }

        const { row, col } = action.payload || {};
        
        if (row === undefined || col === undefined) {
            return { valid: false, error: '위치를 지정해주세요' };
        }

        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
            return { valid: false, error: '보드 범위를 벗어났습니다' };
        }

        if (state.board[row][col] !== null) {
            return { valid: false, error: '이미 돌이 있는 위치입니다' };
        }

        return { valid: true };
    },

    applyAction(state: GomokuState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as GomokuState;
        const { row, col } = action.payload;
        const events: GameEvent[] = [];

        // Place stone
        newState.board[row][col] = playerId;
        newState.lastMove = { row, col };
        newState.moveCount++;

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
                payload: { winner: playerId, winLine, reason: '5목 완성!' }
            });
        } else if (isBoardFull(newState.board)) {
            // Draw - no winner
            newState.winner = 'draw';
            events.push({
                type: 'game_end',
                payload: { winner: null, reason: '무승부' }
            });
        } else {
            // Switch player
            const otherPlayer = newState.players.find(p => p.id !== playerId);
            newState.currentPlayer = otherPlayer!.id;
        }

        return { newState, events };
    },

    getCurrentTurn(state: GomokuState): string | null {
        if (state.winner) return null;
        return state.currentPlayer;
    },

    isGameOver(state: GomokuState): boolean {
        return state.winner !== null;
    },

    getResult(state: GomokuState): GameResult | null {
        if (!state.winner) return null;
        
        if (state.winner === 'draw') {
            return { reason: '무승부' };
        }

        return {
            winnerId: state.winner,
            reason: '5목 완성!'
        };
    },

    getPublicState(state: GomokuState): any {
        return {
            board: state.board,
            currentPlayer: state.currentPlayer,
            players: state.players,
            winner: state.winner,
            winLine: state.winLine,
            lastMove: state.lastMove,
            moveCount: state.moveCount
        };
    },

    getPlayerView(state: GomokuState, playerId: string): any {
        const me = state.players.find(p => p.id === playerId);
        return {
            myColor: me?.color,
            isMyTurn: state.currentPlayer === playerId && !state.winner
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
        
        // Check positive direction
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === playerId) {
                line.push({ row: r, col: c });
            } else {
                break;
            }
        }
        
        // Check negative direction
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === playerId) {
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
    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if (board[i][j] === null) return false;
        }
    }
    return true;
}
