/**
 * 삥패 (Ppingpae) Game Plugin
 *
 * 룸미큐브류 타일 정리 게임. 단일 HTML(`game.cocy.io/ppingpae/`)과 같은 규칙.
 *
 * 프로토콜:
 *   COMPLETE_TURN { board, handIds } — 플레이어가 최종 보드/손패 상태를 커밋.
 *                                       서버가 타일 보존/유효성/초기30점을 검증.
 *   PASS                              — 타일 1장 드로우 후 턴 종료.
 *
 * 권한:
 *   handIds는 본인에게만 노출. 다른 플레이어는 handCount만 봄.
 *   드로우 파일은 카운트만 공개.
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

// ═══════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════
export interface PpingpaeTile {
    id: string;
    color: 'black' | 'red' | 'blue' | 'orange' | 'joker';
    number: number; // 1~13, 조커는 0
    isJoker: boolean;
}

interface PpingpaePlayer {
    id: string;
    nickname: string;
    seat: number;
    handIds: string[];
    hasInitialMeld: boolean;
    score: number;
}

interface PpingpaeGroup {
    gid: number;
    tileIds: string[];
}

interface PpingpaeState {
    players: PpingpaePlayer[];
    tileMap: Record<string, PpingpaeTile>;
    drawPile: string[];
    board: PpingpaeGroup[];
    currentTurn: number;
    consecutivePasses: number;
    gidCounter: number;
    finished: boolean;
    winnerId: string | null;
    endReason: string | null;
    config: {
        timeLimit: number;
        initialHandSize: number;
        initialMeldScore: number;
    };
}

// ═══════════════════════════════════════════
// 타일 풀 / 셔플
// ═══════════════════════════════════════════
const COLORS: PpingpaeTile['color'][] = ['black', 'red', 'blue', 'orange'];

function createTiles(): PpingpaeTile[] {
    const pool: PpingpaeTile[] = [];
    let id = 1;
    for (const color of COLORS) {
        for (let n = 1; n <= 13; n++) {
            pool.push({ id: `t${id++}`, color, number: n, isJoker: false });
            pool.push({ id: `t${id++}`, color, number: n, isJoker: false });
        }
    }
    pool.push({ id: `t${id++}`, color: 'joker', number: 0, isJoker: true });
    pool.push({ id: `t${id++}`, color: 'joker', number: 0, isJoker: true });
    return pool;
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ═══════════════════════════════════════════
// 유효성 검사 (싱글플레이 index.html과 동일 규칙)
// ═══════════════════════════════════════════
export function isValidRun(tiles: PpingpaeTile[]): boolean {
    const n = tiles.length;
    if (n < 3 || n > 13) return false;
    const real = tiles.filter(t => !t.isJoker);
    if (real.length === 0) return n <= 13;
    const color = real[0].color;
    if (!real.every(t => t.color === color)) return false;
    const nums = real.map(t => t.number).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === nums[i - 1]) return false;
    }
    const min = nums[0], max = nums[nums.length - 1];
    if (max - min + 1 > n) return false;
    const sMin = Math.max(1, max - n + 1);
    const sMax = Math.min(min, 14 - n);
    return sMin <= sMax;
}

export function isValidGroup(tiles: PpingpaeTile[]): boolean {
    if (tiles.length < 3 || tiles.length > 4) return false;
    const real = tiles.filter(t => !t.isJoker);
    if (real.length === 0) return true;
    const num = real[0].number;
    if (!real.every(t => t.number === num)) return false;
    const colors = real.map(t => t.color);
    return new Set(colors).size === colors.length;
}

export function isValidSet(tiles: PpingpaeTile[]): boolean {
    if (!tiles || tiles.length < 3) return false;
    return isValidRun(tiles) || isValidGroup(tiles);
}

function tileNumValue(t: PpingpaeTile): number {
    return t.isJoker ? 0 : t.number;
}

// ═══════════════════════════════════════════
// 트랜잭션 검증
// ═══════════════════════════════════════════
function multisetEquals(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const counts = new Map<string, number>();
    for (const x of a) counts.set(x, (counts.get(x) || 0) + 1);
    for (const x of b) {
        const c = counts.get(x);
        if (!c) return false;
        if (c === 1) counts.delete(x); else counts.set(x, c - 1);
    }
    return counts.size === 0;
}

function isSubset(sub: string[], sup: string[]): boolean {
    const counts = new Map<string, number>();
    for (const x of sup) counts.set(x, (counts.get(x) || 0) + 1);
    for (const x of sub) {
        const c = counts.get(x);
        if (!c) return false;
        if (c === 1) counts.delete(x); else counts.set(x, c - 1);
    }
    return true;
}

interface CompleteTurnPayload {
    board: Array<{ gid: number; tileIds: string[] }>;
    handIds: string[];
}

export function validateCompleteTurn(
    state: PpingpaeState,
    playerId: string,
    payload: CompleteTurnPayload,
): ValidationResult {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return { valid: false, error: '플레이어를 찾을 수 없음' };

    const { board: newBoard, handIds: newHand } = payload;
    if (!Array.isArray(newBoard) || !Array.isArray(newHand)) {
        return { valid: false, error: '잘못된 페이로드' };
    }

    // 1. 새 손패는 기존 손패의 부분집합 (보드에서 손패로 추가 못함)
    if (!isSubset(newHand, player.handIds)) {
        return { valid: false, error: '보드에서 손패로 타일을 가져올 수 없습니다' };
    }

    // 2. 최소 1장 이상 냈는지
    const playedTileIds = multisetDiff(player.handIds, newHand);
    if (playedTileIds.length === 0) {
        return { valid: false, error: '최소 1장 이상 내야 합니다' };
    }

    // 3. 타일 보존: oldBoard ∪ oldHand == newBoard ∪ newHand
    const oldAll = state.board.flatMap(g => g.tileIds).concat(player.handIds);
    const newAll = newBoard.flatMap(g => g.tileIds).concat(newHand);
    if (!multisetEquals(oldAll, newAll)) {
        return { valid: false, error: '타일이 변조되었습니다' };
    }

    // 4. 모든 새 보드 그룹이 유효한 세트
    for (const group of newBoard) {
        if (!Array.isArray(group.tileIds) || group.tileIds.length === 0) continue; // 빈 그룹 허용
        const tiles = group.tileIds.map(id => state.tileMap[id]).filter(Boolean);
        if (tiles.length !== group.tileIds.length) {
            return { valid: false, error: '알 수 없는 타일이 포함됨' };
        }
        if (!isValidSet(tiles)) {
            return { valid: false, error: '유효하지 않은 조합이 있습니다' };
        }
    }

    // 5. 초기 출전: 손패에서 낸 타일 합 >= 30 (조커 0점)
    if (!player.hasInitialMeld) {
        const playedScore = playedTileIds.reduce((sum, id) => {
            const t = state.tileMap[id];
            return sum + tileNumValue(t);
        }, 0);
        if (playedScore < state.config.initialMeldScore) {
            return { valid: false, error: `첫 출전은 합계 ${state.config.initialMeldScore}점 이상이어야 합니다 (현재 ${playedScore})` };
        }
    }

    return { valid: true };
}

function multisetDiff(a: string[], b: string[]): string[] {
    const counts = new Map<string, number>();
    for (const x of b) counts.set(x, (counts.get(x) || 0) + 1);
    const result: string[] = [];
    for (const x of a) {
        const c = counts.get(x);
        if (c) {
            if (c === 1) counts.delete(x); else counts.set(x, c - 1);
        } else {
            result.push(x);
        }
    }
    return result;
}

// ═══════════════════════════════════════════
// 게임 진행
// ═══════════════════════════════════════════
function advanceTurn(state: PpingpaeState): void {
    state.currentTurn = (state.currentTurn + 1) % state.players.length;
}

function drawTile(state: PpingpaeState, playerId: string): string | null {
    if (state.drawPile.length === 0) return null;
    const tileId = state.drawPile.shift()!;
    const player = state.players.find(p => p.id === playerId)!;
    player.handIds.push(tileId);
    return tileId;
}

function checkStalemate(state: PpingpaeState): boolean {
    return state.drawPile.length === 0 && state.consecutivePasses >= state.players.length;
}

function endByWin(state: PpingpaeState, winner: PpingpaePlayer): void {
    state.finished = true;
    state.winnerId = winner.id;
    state.endReason = `${winner.nickname} 손패 모두 정리`;
    // 남은 플레이어 점수 차감
    for (const p of state.players) {
        if (p.id === winner.id) continue;
        const remaining = p.handIds.reduce((s, id) => s + (state.tileMap[id].isJoker ? 30 : state.tileMap[id].number), 0);
        p.score -= remaining;
        winner.score += remaining;
    }
}

function endByStalemate(state: PpingpaeState): void {
    state.finished = true;
    state.endReason = '덱 소진 — 잔여 타일 최저 플레이어 승';
    const scores = state.players.map(p => ({
        p,
        remaining: p.handIds.reduce((s, id) => s + (state.tileMap[id].isJoker ? 30 : state.tileMap[id].number), 0),
    }));
    const min = Math.min(...scores.map(s => s.remaining));
    const winners = scores.filter(s => s.remaining === min).map(s => s.p);
    state.winnerId = winners.length === 1 ? winners[0].id : null;
    for (const { p, remaining } of scores) {
        p.score -= remaining;
    }
}

// ═══════════════════════════════════════════
// 플러그인
// ═══════════════════════════════════════════
export const ppingpaePlugin: GamePlugin = {
    id: 'ppingpae',
    name: '삥패',
    minPlayers: 1,
    maxPlayers: 4,

    createInitialState(players: Player[], config?: any): PpingpaeState {
        const pool = shuffle(createTiles());
        const tileMap: Record<string, PpingpaeTile> = {};
        for (const t of pool) tileMap[t.id] = t;

        const initialHandSize = config?.initialHandSize ?? 14;
        const initialMeldScore = config?.initialMeldScore ?? 30;
        const timeLimit = config?.timeLimit ?? 60;

        // 빈 좌석 ai-* 로 채움(서버 자동 플레이=getAIAction). want = max(접속자, config.seats), 최대 4.
        const want = Math.min(4, Math.max(players.length, (Number(config?.seats) | 0) || players.length));
        const allP: { id: string; nickname: string; seat: number }[] =
            players.map((p, i) => ({ id: p.id, nickname: p.nickname, seat: i }));
        for (let seat = players.length; seat < want; seat++) {
            allP.push({ id: `ai-${seat}`, nickname: `🤖 봇${seat + 1}`, seat });
        }

        const orderedPool = pool.map(t => t.id);
        const dealtPlayers: PpingpaePlayer[] = allP.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            seat: p.seat,
            handIds: orderedPool.splice(0, initialHandSize),
            hasInitialMeld: false,
            score: 0,
        }));

        return {
            players: dealtPlayers,
            tileMap,
            drawPile: orderedPool,
            board: [],
            currentTurn: 0,
            consecutivePasses: 0,
            gidCounter: 0,
            finished: false,
            winnerId: null,
            endReason: null,
            config: { timeLimit, initialHandSize, initialMeldScore },
        };
    },

    validateAction(state: PpingpaeState, action: GameAction, playerId: string): ValidationResult {
        // 리액션(이모트): 상태 변경 없는 브로드캐스트 — 턴/종료 무관하게 허용
        if (action.type === 'REACTION_EMOTE') return { valid: true };
        if (state.finished) return { valid: false, error: '게임이 이미 종료됨' };
        const currentPlayer = state.players[state.currentTurn];
        if (!currentPlayer || currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 턴이 아닙니다' };
        }
        switch (action.type) {
            case 'COMPLETE_TURN':
                return validateCompleteTurn(state, playerId, action.payload as CompleteTurnPayload);
            case 'PASS':
                return { valid: true };
            default:
                return { valid: false, error: `알 수 없는 액션: ${action.type}` };
        }
    },

    applyAction(state: PpingpaeState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as PpingpaeState;
        const events: GameEvent[] = [];
        // 리액션: 상태 변경 없이 액션만 브로드캐스트(서버는 action 이벤트로 전 클라에 전달)
        if (action.type === 'REACTION_EMOTE') return { newState, events };
        const player = newState.players.find(p => p.id === playerId)!;

        if (action.type === 'COMPLETE_TURN') {
            const { board: nextBoard, handIds: nextHand } = action.payload as CompleteTurnPayload;
            const playedCount = player.handIds.length - nextHand.length;
            const playedTiles = multisetDiff(player.handIds, nextHand);

            // 빈 그룹 정리하고 gid 새로 할당 (gid는 매 턴 UI 핸들로만 쓰임)
            newState.board = nextBoard
                .filter(g => g.tileIds && g.tileIds.length > 0)
                .map(g => ({ gid: ++newState.gidCounter, tileIds: [...g.tileIds] }));

            player.handIds = [...nextHand];
            if (!player.hasInitialMeld) player.hasInitialMeld = true;
            newState.consecutivePasses = 0;

            events.push({
                type: 'turn_committed',
                playerId,
                payload: { playedCount, playedTileIds: playedTiles, handCount: player.handIds.length },
            });

            // 승리 체크
            if (player.handIds.length === 0) {
                endByWin(newState, player);
                events.push({ type: 'game_ended', playerId, payload: { winnerId: player.id, reason: newState.endReason } });
                return { newState, events };
            }

            advanceTurn(newState);
            events.push({ type: 'turn_advanced', payload: { nextSeat: newState.currentTurn } });
            return { newState, events };
        }

        if (action.type === 'PASS') {
            const drawnId = drawTile(newState, playerId);
            newState.consecutivePasses += 1;
            events.push({
                type: 'passed',
                playerId,
                payload: { drewTile: !!drawnId, drawPileCount: newState.drawPile.length },
            });

            if (checkStalemate(newState)) {
                endByStalemate(newState);
                events.push({ type: 'game_ended', payload: { winnerId: newState.winnerId, reason: newState.endReason } });
                return { newState, events };
            }

            advanceTurn(newState);
            events.push({ type: 'turn_advanced', payload: { nextSeat: newState.currentTurn } });
            return { newState, events };
        }

        return { newState, events };
    },

    getCurrentTurn(state: PpingpaeState): string | null {
        if (state.finished) return null;
        return state.players[state.currentTurn]?.id || null;
    },

    isGameOver(state: PpingpaeState): boolean {
        return state.finished;
    },

    getResult(state: PpingpaeState): GameResult | null {
        if (!state.finished) return null;
        return {
            winnerId: state.winnerId || undefined,
            scores: Object.fromEntries(state.players.map(p => [p.id, p.score])),
            reason: state.endReason || '',
        };
    },

    getPublicState(state: PpingpaeState): any {
        // 핵심: 다른 플레이어 손패는 카운트만, 드로우 파일도 카운트만
        return {
            players: state.players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                seat: p.seat,
                handCount: p.handIds.length,
                hasInitialMeld: p.hasInitialMeld,
                score: p.score,
            })),
            board: state.board.map(g => ({
                gid: g.gid,
                tiles: g.tileIds.map(id => state.tileMap[id]),
            })),
            currentTurn: state.currentTurn,
            drawPileCount: state.drawPile.length,
            consecutivePasses: state.consecutivePasses,
            finished: state.finished,
            winnerId: state.winnerId,
            endReason: state.endReason,
            config: state.config,
        };
    },

    getPlayerView(state: PpingpaeState, playerId: string): any {
        const me = state.players.find(p => p.id === playerId);
        const myHand = me ? me.handIds.map(id => state.tileMap[id]) : [];
        return {
            ...this.getPublicState(state),
            myHand,
            myHandIds: me ? [...me.handIds] : [],
            hasInitialMeld: me ? me.hasInitialMeld : false,
            isMyTurn: state.players[state.currentTurn]?.id === playerId,
        };
    },

    getTimeoutAction(state: PpingpaeState, playerId: string): GameAction | null {
        if (state.finished) return null;
        const current = state.players[state.currentTurn];
        if (!current || current.id !== playerId) return null;
        return { type: 'PASS' };
    },

    getAIAction(state: PpingpaeState, _playerId: string): GameAction {
        // Simple AI: always pass (draw a tile)
        return { type: 'PASS' };
    },
};
