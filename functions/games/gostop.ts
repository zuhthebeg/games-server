/**
 * 맞고/고스톱 (Gostop) Game Plugin — 화투 2인 맞고 (server-authoritative)
 *
 * 단일 HTML(game.cocy.io/gostop/)과 동일 규칙: 광/끗/띠/피·고도리·고/스톱·피박·광박,
 * 특수룰(뻑/따닥/쪽/쓸/뻑쓸이/자뻑/폭탄/흔들기).
 *
 * 프로토콜:
 *   PLAY { cardId, pick? }  — 손패 1장 냄. pick = 바닥에 같은 월 2장일 때 먹을 카드 id(선택).
 *   BOMB { month }          — 손에 같은 월 3장 + 바닥 1장 → 폭탄.
 *   GO                      — 7점↑ 도달 시 계속(배수↑).
 *   STOP                    — 7점↑ 도달 시 종료.
 *
 * 권한: 내 손패만 노출, 상대는 handCount만. 먹은 패/바닥은 공개.
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

const GO_MIN = 7;

interface Card { id: string; m: number; role: string; gwang: boolean; bigwang: boolean; godori: boolean; tti: string | null; ssangpi: boolean; file: string; }
interface GPlayer { id: string; nickname: string; seat: number; hand: string[]; cap: string[]; }
interface GostopState {
    cardMap: Record<string, Card>;
    deck: string[];
    table: string[];
    players: GPlayer[];
    currentTurn: number;
    go: number; goBy: number;
    shakeMult: number[];
    ppukCount: number[];
    ppukOwner: Record<number, number>;
    pending: { kind: 'gostop'; seat: number; total: number } | null;
    bet: number;
    finished: boolean;
    winnerSeat: number | null;
    scores: Record<string, number>;
    endReason: string | null;
    lastEvent: any;
    config: { timeLimit: number; bet: number };
}

// ── 덱 구성 (클라와 동일) ──
const GW = [1, 3, 8, 11, 12], YUL = [2, 4, 5, 6, 7, 8, 9, 10, 12], TTI = [1, 2, 3, 4, 5, 6, 7, 9, 10, 12];
const PIN: Record<number, number> = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 3, 12: 1 };
const TTI_GROUP: Record<number, string> = { 1: 'hong', 2: 'hong', 3: 'hong', 6: 'chung', 9: 'chung', 10: 'chung', 4: 'cho', 5: 'cho', 7: 'cho', 12: 'plain' };

function buildDeck(): Card[] {
    const d: Card[] = [];
    const mk = (m: number, role: string, idx: string | number) => {
        const file = `cards/m${String(m).padStart(2, '0')}_${role}${idx}.svg`;
        d.push({
            id: `m${m}_${role}${idx}`, m, role, file,
            gwang: role === 'gwang', bigwang: role === 'gwang' && m === 12,
            godori: role === 'yul' && [2, 4, 8].includes(m),
            tti: role === 'tti' ? TTI_GROUP[m] : null,
            ssangpi: (m === 11 && role === 'pi' && idx === 3) || (m === 12 && role === 'pi'),
        });
    };
    GW.forEach(m => mk(m, 'gwang', ''));
    YUL.forEach(m => mk(m, 'yul', ''));
    TTI.forEach(m => mk(m, 'tti', ''));
    for (let m = 1; m <= 12; m++) { const n = PIN[m]; for (let i = 1; i <= n; i++) mk(m, 'pi', n === 1 ? '' : i); }
    return d;
}
function shuffle<T>(arr: T[]): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── 헬퍼 ──
const cm = (s: GostopState, id: string) => s.cardMap[id];
function sameMonth(s: GostopState, arr: string[], m: number): string[] { return arr.filter(id => cm(s, id).m === m); }
function cardValue(c: Card): number { return c.gwang ? 4 : c.ssangpi ? 3 : c.role === 'yul' ? 2 : c.role === 'tti' ? 2 : 1; }
function removeFromTable(s: GostopState, id: string) { const i = s.table.indexOf(id); if (i >= 0) s.table.splice(i, 1); }
function stealPi(s: GostopState, from: number, to: number): string | null {
    const src = s.players[from].cap;
    let j = src.findIndex(id => cm(s, id).role === 'pi' && !cm(s, id).ssangpi);
    if (j < 0) j = src.findIndex(id => cm(s, id).role === 'pi');
    if (j < 0) return null;
    const id = src.splice(j, 1)[0]; s.players[to].cap.push(id); return id;
}

// ── 점수 (클라와 동일) ──
function score(s: GostopState, cap: string[]) {
    const cs = cap.map(id => cm(s, id));
    const gw = cs.filter(c => c.gwang), yul = cs.filter(c => c.role === 'yul'), tti = cs.filter(c => c.role === 'tti'), pi = cs.filter(c => c.role === 'pi');
    let total = 0; const parts: [string, number][] = [];
    const ng = gw.length, hasBi = gw.some(c => c.bigwang); let gp = 0;
    if (ng >= 5) gp = 15; else if (ng === 4) gp = 4; else if (ng === 3) gp = hasBi ? 2 : 3;
    if (gp) { total += gp; parts.push(['광 ' + ng + '개', gp]); }
    const ny = yul.length; let yp = 0; if (ny >= 5) yp = ny - 4;
    const godori = yul.filter(c => c.godori).length; if (godori >= 3) { yp += 5; parts.push(['고도리', 5]); }
    if (ny >= 5) parts.push(['끗 ' + ny + '개', ny - 4]); total += yp;
    const nt = tti.length; let tp = 0; if (nt >= 5) tp += nt - 4;
    const hong = tti.filter(c => c.tti === 'hong').length, chung = tti.filter(c => c.tti === 'chung').length, cho = tti.filter(c => c.tti === 'cho').length;
    if (hong >= 3) { tp += 3; parts.push(['홍단', 3]); }
    if (chung >= 3) { tp += 3; parts.push(['청단', 3]); }
    if (cho >= 3) { tp += 3; parts.push(['초단', 3]); }
    if (nt >= 5) parts.push(['띠 ' + nt + '개', nt - 4]); total += tp;
    const np = pi.reduce((a, c) => a + (c.ssangpi ? 2 : 1), 0); let pp = 0;
    if (np >= 10) { pp = np - 9; parts.push(['피 ' + np + '장', pp]); } total += pp;
    return { total, parts, gw: ng, pi: np };
}

// ── 플레이 해석 (착지→뒤집기→캡처→특수룰), takeTurn 포팅 ──
function resolvePlay(s: GostopState, seat: number, handIds: string[], bomb: boolean, pickId?: string) {
    const pl = s.players[seat];
    const playM = cm(s, handIds[0]).m;
    const preM = sameMonth(s, s.table, playM);
    const beforeM = preM.length;
    if (!s.shakeMult) s.shakeMult = [1, 1];
    // 손패 빼서 바닥에 올림
    handIds.forEach(id => { const i = pl.hand.indexOf(id); if (i >= 0) pl.hand.splice(i, 1); s.table.push(id); });
    // 흔들기 판정 (빼기 전 보유수 = handIds.length는 1, 별도로 체크) — 낸 월을 3장 들고 있었는지: hand+played
    if (!bomb) {
        const stillHas = pl.hand.filter(id => cm(s, id).m === playM).length;
        if ((stillHas + handIds.length) >= 3 && beforeM >= 1 && s.shakeMult[seat] === 1) s.shakeMult[seat] = 2;
    }
    // 뒤집기
    let flipId: string | null = null;
    if (s.deck.length) { flipId = s.deck.shift()!; s.table.push(flipId); }
    const flipSame = !!(flipId && cm(s, flipId).m === playM);

    let captured: string[] = []; let ppuk = false; let flipSweepM: number | null = null;
    const inCap = (id: string) => captured.includes(id);
    if (bomb) {
        captured.push(...preM, ...handIds);
    } else if (beforeM === 0) {
        if (flipSame) captured.push(...handIds, flipId!);
    } else if (beforeM === 1) {
        if (flipSame) { ppuk = true; s.ppukCount[seat] = (s.ppukCount[seat] || 0) + 1; s.ppukOwner[playM] = seat; }
        else captured.push(handIds[0], preM[0]);
    } else if (beforeM === 2) {
        if (flipSame) captured.push(handIds[0], preM[0], preM[1], flipId!);
        else {
            let take = pickId && preM.includes(pickId) ? pickId : preM.slice().sort((a, b) => cardValue(cm(s, b)) - cardValue(cm(s, a)))[0];
            captured.push(handIds[0], take);
        }
    } else {
        captured.push(handIds[0], ...preM);
    }
    if (flipId && !flipSame && !inCap(flipId)) {
        const fm = s.table.filter(id => cm(s, id).m === cm(s, flipId!).m && id !== flipId && !inCap(id));
        if (fm.length >= 3) { captured.push(flipId, ...fm); flipSweepM = cm(s, flipId).m; }
        else if (fm.length === 2) captured.push(flipId, fm.slice().sort((a, b) => cardValue(cm(s, b)) - cardValue(cm(s, a)))[0]);
        else if (fm.length === 1) captured.push(flipId, fm[0]);
    }

    const willEmpty = (s.table.length - captured.length) === 0 && captured.length > 0;
    const canSteal = s.deck.length > 0;
    let steals = 0; const stags: string[] = []; const stolen: string[] = [];
    const opp = 1 - seat;
    if (!ppuk) {
        if (bomb) { steals++; stags.push('폭탄'); }
        if (flipSame && beforeM === 2) { steals++; stags.push('따닥'); }
        if (flipSame && beforeM === 0) { steals++; stags.push('쪽'); }
        if (beforeM >= 3) { const own = s.ppukOwner[playM]; if (own === seat) { steals += 2; stags.push('자뻑'); } else { steals++; stags.push('뻑쓸이'); } if (own != null) delete s.ppukOwner[playM]; }
        if (flipSweepM != null) { const own = s.ppukOwner[flipSweepM]; if (own === seat) { steals += 2; stags.push('자뻑'); } else { steals++; stags.push('뻑쓸이'); } if (own != null) delete s.ppukOwner[flipSweepM]; }
        if (willEmpty) { steals++; stags.push('쓸'); }
    }
    // 캡처 확정
    captured.forEach(id => removeFromTable(s, id));
    if (canSteal) for (let i = 0; i < steals; i++) { const sp = stealPi(s, opp, seat); if (sp) stolen.push(sp); }
    pl.cap.push(...captured);
    return { playM, captured, flipId, ppuk, stags, stolen, beforeM, flipSame };
}

function bestPlay(s: GostopState, seat: number): { cardId: string } {
    const pl = s.players[seat];
    let best = pl.hand[0], bestV = -1;
    for (const id of pl.hand) { const c = cm(s, id); const m = sameMonth(s, s.table, c.m); const v = m.length ? Math.max(...m.map(x => cardValue(cm(s, x)))) + (c.gwang ? 2 : 0) : (-cardValue(c) * 0.1); if (v > bestV) { bestV = v; best = id; } }
    return { cardId: best };
}
function bombMonth(s: GostopState, seat: number): number | null {
    const pl = s.players[seat]; const cnt: Record<number, number> = {};
    pl.hand.forEach(id => { const m = cm(s, id).m; cnt[m] = (cnt[m] || 0) + 1; });
    const m = Object.keys(cnt).find(mm => cnt[+mm] >= 3 && sameMonth(s, s.table, +mm).length >= 1);
    return m ? +m : null;
}

function settle(s: GostopState, winner: number, opts?: { ppuk3?: boolean }) {
    const loser = 1 - winner; const ls = score(s, s.players[loser].cap); const sc = score(s, s.players[winner].cap);
    let pt: number; const tags: string[] = [];
    if (opts?.ppuk3) { pt = 10; tags.push('3뻑'); }
    else {
        pt = sc.total; let mult = 1;
        if (s.go > 0) { const gm = Math.pow(2, Math.max(0, s.go - 1)); mult *= gm; tags.push(s.go + '고'); }
        if (ls.pi <= 6) { mult *= 2; tags.push('피박'); }
        if (sc.gw >= 3 && ls.gw === 0) { mult *= 2; tags.push('광박'); }
        if (s.shakeMult[winner] > 1) { mult *= s.shakeMult[winner]; tags.push('흔들기'); }
        pt *= mult;
    }
    s.finished = true; s.winnerSeat = winner;
    s.endReason = (sc.parts.map(p => p[0] + '+' + p[1]).join(' ')) + (tags.length ? ' · ' + tags.join('·') : '') + ` = ${pt}점`;
    const gold = pt * 10000 * (s.bet || 1);
    s.scores = {};
    s.players.forEach((p, i) => { s.scores[p.id] = i === winner ? gold : -gold; });
    s.pending = null;
}

// 점수 도달 → 고/스톱 대기 or 턴 진행
function afterPlay(s: GostopState, seat: number, prevScore: number, events: GameEvent[], bomb: boolean) {
    const pl = s.players[seat];
    if (s.ppukCount[seat] >= 3) { settle(s, seat, { ppuk3: true }); events.push({ type: 'win', payload: { seat, reason: s.endReason } }); return; }
    const sc = score(s, pl.cap);
    if (sc.total >= GO_MIN && sc.total > prevScore && s.deck.length > 0 && pl.hand.length > 0) {
        (pl as any)._last = sc.total;
        s.pending = { kind: 'gostop', seat, total: sc.total };
        events.push({ type: 'gostop_choice', playerId: pl.id, payload: { seat, total: sc.total, go: s.go } });
        return;
    }
    (pl as any)._last = Math.max((pl as any)._last || 0, sc.total);
    if (bomb && !s.finished) { if (pl.hand.length === 0) { advance(s, events); return; } events.push({ type: 'extra_turn', payload: { seat } }); return; }
    advance(s, events);
}
function advance(s: GostopState, events: GameEvent[]) {
    s.currentTurn = 1 - s.currentTurn;
    if (s.players[s.currentTurn].hand.length === 0) {
        // 다음 차례가 낼 패 없음 → 나가리
        s.finished = true; s.winnerSeat = null; s.endReason = '나가리'; s.scores = {}; s.players.forEach(p => s.scores[p.id] = 0);
        events.push({ type: 'draw', payload: {} }); return;
    }
    events.push({ type: 'turn', payload: { seat: s.currentTurn } });
}

export const gostopPlugin: GamePlugin = {
    id: 'gostop',
    name: '맞고 (화투)',
    minPlayers: 2,
    maxPlayers: 2,

    createInitialState(players: Player[], config?: any): GostopState {
        const deckCards = shuffle(buildDeck());
        const cardMap: Record<string, Card> = {};
        deckCards.forEach(c => cardMap[c.id] = c);
        const ids = deckCards.map(c => c.id);
        const table = ids.splice(0, 8);
        const gp: GPlayer[] = players.map(p => ({ id: p.id, nickname: p.nickname, seat: p.seat, hand: [], cap: [] }));
        for (let r = 0; r < 10; r++) for (const p of gp) p.hand.push(ids.shift()!);
        gp.forEach(p => p.hand.sort((a, b) => cardMap[a].m - cardMap[b].m));
        return {
            cardMap, deck: ids, table, players: gp, currentTurn: 0,
            go: 0, goBy: -1, shakeMult: [1, 1], ppukCount: [0, 0], ppukOwner: {},
            pending: null, bet: config?.bet ?? 1, finished: false, winnerSeat: null, scores: {}, endReason: null,
            lastEvent: null, config: { timeLimit: config?.timeLimit ?? 30, bet: config?.bet ?? 1 },
        };
    },

    validateAction(state: GostopState, action: GameAction, playerId: string): ValidationResult {
        if (state.finished) return { valid: false, error: '게임 종료됨' };
        const seat = state.players.findIndex(p => p.id === playerId);
        if (seat < 0) return { valid: false, error: '플레이어 없음' };
        if (state.pending) {
            if (state.pending.seat !== seat) return { valid: false, error: '당신 차례 아님' };
            if (action.type !== 'GO' && action.type !== 'STOP') return { valid: false, error: '고/스톱 선택 필요' };
            return { valid: true };
        }
        if (state.currentTurn !== seat) return { valid: false, error: '당신 차례 아님' };
        const pl = state.players[seat];
        if (action.type === 'PLAY') {
            const id = action.payload?.cardId;
            if (!id || !pl.hand.includes(id)) return { valid: false, error: '손패에 없는 카드' };
            return { valid: true };
        }
        if (action.type === 'BOMB') {
            const m = +action.payload?.month;
            const cnt = pl.hand.filter(x => state.cardMap[x].m === m).length;
            if (cnt < 3 || sameMonth(state, state.table, m).length < 1) return { valid: false, error: '폭탄 불가' };
            return { valid: true };
        }
        return { valid: false, error: '알 수 없는 액션' };
    },

    applyAction(state: GostopState, action: GameAction, playerId: string): ActionResult {
        const s = JSON.parse(JSON.stringify(state)) as GostopState;
        const events: GameEvent[] = [];
        const seat = s.players.findIndex(p => p.id === playerId);
        const pl = s.players[seat];

        if (s.pending && (action.type === 'GO' || action.type === 'STOP')) {
            const total = s.pending.total; s.pending = null;
            if (action.type === 'GO') { s.go++; s.goBy = seat; events.push({ type: 'go', payload: { seat, go: s.go } }); advance(s, events); }
            else { settle(s, seat); events.push({ type: 'win', payload: { seat, reason: s.endReason } }); }
            return { newState: s, events };
        }

        const prevScore = (pl as any)._last || 0;
        if (action.type === 'BOMB') {
            const m = +action.payload.month;
            const three: string[] = pl.hand.filter(x => s.cardMap[x].m === m).slice(0, 3);
            const r = resolvePlay(s, seat, three, true);
            events.push({ type: 'play', playerId, payload: { bomb: true, ...r } });
            afterPlay(s, seat, prevScore, events, true);
            return { newState: s, events };
        }
        // PLAY
        const cardId = action.payload.cardId;
        const r = resolvePlay(s, seat, [cardId], false, action.payload?.pick);
        events.push({ type: 'play', playerId, payload: { cardId, ...r } });
        afterPlay(s, seat, prevScore, events, false);
        return { newState: s, events };
    },

    getCurrentTurn(state: GostopState): string | null {
        if (state.finished) return null;
        if (state.pending) return state.players[state.pending.seat]?.id || null;
        return state.players[state.currentTurn]?.id || null;
    },

    isGameOver(state: GostopState): boolean { return state.finished; },

    getResult(state: GostopState): GameResult | null {
        if (!state.finished) return null;
        return {
            winnerId: state.winnerSeat != null ? state.players[state.winnerSeat].id : undefined,
            scores: state.scores,
            reason: state.endReason || '',
        };
    },

    getPublicState(state: GostopState): any {
        return {
            players: state.players.map(p => ({ id: p.id, nickname: p.nickname, seat: p.seat, handCount: p.hand.length, cap: p.cap.map(id => state.cardMap[id]) })),
            table: state.table.map(id => state.cardMap[id]),
            deckCount: state.deck.length,
            currentTurn: state.currentTurn,
            go: state.go, goBy: state.goBy,
            pending: state.pending,
            finished: state.finished, winnerSeat: state.winnerSeat, scores: state.scores, endReason: state.endReason,
            config: state.config,
        };
    },

    getPlayerView(state: GostopState, playerId: string): any {
        const me = state.players.find(p => p.id === playerId);
        const seat = me ? me.seat : -1;
        const sc = me ? score(state, me.cap).total : 0;
        return {
            ...this.getPublicState(state),
            mySeat: seat,
            myHand: me ? me.hand.map(id => state.cardMap[id]) : [],
            myScore: sc,
            isMyTurn: state.pending ? state.pending.seat === seat : state.currentTurn === seat,
        };
    },

    getTimeoutAction(state: GostopState, playerId: string): GameAction | null {
        if (state.finished) return null;
        const seat = state.players.findIndex(p => p.id === playerId);
        if (seat < 0) return null;
        if (state.pending) { if (state.pending.seat === seat) return { type: 'STOP' }; return null; }
        if (state.currentTurn !== seat) return null;
        const b = bombMonth(state, seat); if (b != null) return { type: 'BOMB', payload: { month: b } };
        return { type: 'PLAY', payload: { cardId: bestPlay(state, seat).cardId } };
    },

    getAIAction(state: GostopState, playerId: string): GameAction {
        const seat = state.players.findIndex(p => p.id === playerId);
        if (state.pending && state.pending.seat === seat) {
            // 점수 낮으면 고, 높거나 덱 적으면 스톱
            const goAgain = state.pending.total < 5 && state.deck.length > 6 && Math.random() < 0.55;
            return goAgain ? { type: 'GO' } : { type: 'STOP' };
        }
        const b = bombMonth(state, seat); if (b != null) return { type: 'BOMB', payload: { month: b } };
        return { type: 'PLAY', payload: { cardId: bestPlay(state, seat).cardId } };
    },
};
