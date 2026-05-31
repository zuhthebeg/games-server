/**
 * 대만 마작 (Taiwan Mahjong) Game Plugin — server engine
 *
 * 단일 HTML(game.cocy.io/mahjong/)과 동일 규칙. 4인, 16장 핸드, 대만 룰.
 * 빈 좌석은 ai-* 플레이어로 채워 서버가 자동 플레이.
 *
 * 프로토콜 (sendAction):
 *   DISCARD { tile }                  — 내 차례(자동 드로우 후) 패 버리기
 *   TSUMO                             — 내 차례 자모(쯔모) 화료
 *   KAN { tile, kanType:'an'|'add' }  — 내 차례 안깡/가깡 + 보충
 *   CLAIM { what:'ron'|'pon'|'kan'|'chi', tiles? } — 직전 버린 패 클레임
 *   PASS                              — 클레임 포기
 *
 * 클레임은 릴레이의 단일-현재턴 모델에 맞춰 우선순위 순차 서브턴으로 처리:
 *   론 > 퐁/깡 > 치. getCurrentTurn이 미결정 최고우선 클레이머를 가리킴.
 *
 * 권한: 본인 hand/flowers/lastDraw만 myView로 노출. 타인은 handCount만.
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

type Tid = string;

// ───────── 타일 헬퍼 ─────────
const suit = (id: Tid) => id[0];
const num = (id: Tid) => parseInt(id.slice(1));
const isFlower = (id: Tid) => id[0] === 'f';
const isTerminal = (id: Tid) => 'mps'.includes(suit(id)) && (num(id) === 1 || num(id) === 9);

function buildWall(): Tid[] {
    const t: Tid[] = [];
    for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) t.push(s + n);
    for (let n = 1; n <= 7; n++) for (let k = 0; k < 4; k++) t.push('z' + n);
    for (let n = 1; n <= 8; n++) t.push('f' + n);
    return t;
}
function shuffle<T>(a: T[]): T[] {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; }
    return r;
}
function countMap(t: Tid[]): Record<string, number> { const c: Record<string, number> = {}; for (const x of t) c[x] = (c[x] || 0) + 1; return c; }
function removeN(arr: Tid[], tile: Tid, n: number): Tid[] { const r = [...arr]; let rem = n; for (let i = r.length - 1; i >= 0 && rem > 0; i--) if (r[i] === tile) { r.splice(i, 1); rem--; } return r; }
function sortHand(h: Tid[]): Tid[] { const o: Record<string, number> = { m: 0, p: 1, s: 2, z: 3, f: 4 }; return [...h].sort((a, b) => { const sa = o[a[0]] ?? 5, sb = o[b[0]] ?? 5; return sa !== sb ? sa - sb : num(a) - num(b); }); }

// ───────── 화료 판정 ─────────
function canFormSets(tiles: Tid[], needed: number): boolean {
    if (tiles.length === 0) return needed === 0;
    if (needed === 0) return tiles.length === 0;
    const t = tiles[0], s = suit(t), n = num(t), c = countMap(tiles);
    if ((c[t] || 0) >= 3) { if (canFormSets(removeN(tiles, t, 3), needed - 1)) return true; }
    if ('mps'.includes(s)) {
        const t2 = s + (n + 1), t3 = s + (n + 2);
        if ((c[t2] || 0) >= 1 && (c[t3] || 0) >= 1) {
            const r = removeN(removeN(removeN(tiles, t, 1), t2, 1), t3, 1);
            if (canFormSets(r, needed - 1)) return true;
        }
    }
    return false;
}
function sevenPairs(h: Tid[]): boolean { if (h.length !== 14) return false; const c = countMap(h); return Object.values(c).every(v => v === 2) && Object.keys(c).length === 7; }
function thirteenOrphans(h: Tid[]): boolean { if (h.length !== 14) return false; const O = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7']; const c = countMap(h); return O.every(t => (c[t] || 0) >= 1) && O.some(t => (c[t] || 0) >= 2); }
function canWin(hand: Tid[], melds: Meld[]): boolean {
    const needed = 5 - melds.length; if (needed < 0) return false;
    if (needed === 5 && sevenPairs(hand)) return true;
    if (needed === 5 && thirteenOrphans(hand)) return true;
    hand = [...hand].sort();  // canFormSets는 tiles[0]=최소패(정렬) 전제 → 승리패가 끝에 붙어 정렬 깨지는 것 방지
    const c = countMap(hand);
    for (const t of Object.keys(c)) { if (c[t] >= 2) { const rest = removeN(hand, t, 2); if (canFormSets(rest, needed)) return true; } }
    return false;
}
function chiOptions(hand: Tid[], disc: Tid): Tid[][] {
    const s = suit(disc), n = num(disc); if (!'mps'.includes(s)) return [];
    const opts: Tid[][] = []; const h = new Set(hand);
    if (n >= 2 && n <= 8 && h.has(s + (n - 1)) && h.has(s + (n + 1))) opts.push([s + (n - 1), disc, s + (n + 1)]);
    if (n >= 3 && h.has(s + (n - 2)) && h.has(s + (n - 1))) opts.push([s + (n - 2), s + (n - 1), disc]);
    if (n <= 7 && h.has(s + (n + 1)) && h.has(s + (n + 2))) opts.push([disc, s + (n + 1), s + (n + 2)]);
    const seen = new Set<string>();
    return opts.filter(o => { const k = [...o].sort().join(','); if (seen.has(k)) return false; seen.add(k); return true; });
}
const canPon = (hand: Tid[], tile: Tid) => hand.filter(t => t === tile).length >= 2;
const canMinKan = (hand: Tid[], tile: Tid) => hand.filter(t => t === tile).length >= 3;
function canAnKan(hand: Tid[]): Tid[] { const c = countMap(hand); return Object.entries(c).filter(([, n]) => n >= 4).map(([t]) => t); }
const ALL_TILES: Tid[] = (() => { const a: Tid[] = []; for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) a.push(s + n); for (let n = 1; n <= 7; n++) a.push('z' + n); return a; })();
function isTenpai(hand: Tid[], melds: Meld[]): boolean { for (const tt of ALL_TILES) { if (canWin([...hand, tt], melds)) return true; } return false; }

// ───────── 역(台) 계산 ─────────
function isYakuhai(tile: Tid | null, pidx: number, windIdx: number): boolean { if (!tile) return false; const s = suit(tile), n = num(tile); if (s !== 'z') return false; if (n >= 5) return true; return n === (pidx + 1) || n === (windIdx + 1); }
function yakuhaiBonus(tile: Tid, pidx: number, windIdx: number): number { const s = suit(tile); if (s !== 'z') return 0; const n = num(tile); if (n >= 5) return 1; if (n === (pidx + 1) || n === (windIdx + 1)) return 2; return 1; }
function isTwoSided(hand: Tid[], winTile: Tid): boolean { const s = suit(winTile), n = num(winTile); if (!'mps'.includes(s)) return false; const rest = removeN(hand, winTile, 1); const c = countMap(rest); return (n >= 2 && (c[s + (n - 1)] || 0) >= 1) || (n <= 8 && (c[s + (n + 1)] || 0) >= 1); }
interface SetPart { type: 'tri' | 'seq'; tile: Tid; }
function extractSets(tiles: Tid[], needed: number): SetPart[] | null {
    if (tiles.length === 0) return needed === 0 ? [] : null;
    if (needed === 0) return tiles.length === 0 ? [] : null;
    const t = tiles[0], s = suit(t), n = num(t), c = countMap(tiles);
    if ((c[t] || 0) >= 3) { const r = extractSets(removeN(tiles, t, 3), needed - 1); if (r !== null) return [{ type: 'tri', tile: t }, ...r]; }
    if ('mps'.includes(s)) {
        const t2 = s + (n + 1), t3 = s + (n + 2);
        if ((c[t2] || 0) >= 1 && (c[t3] || 0) >= 1) {
            const r2 = removeN(removeN(removeN(tiles, t, 1), t2, 1), t3, 1);
            const r = extractSets(r2, needed - 1); if (r !== null) return [{ type: 'seq', tile: t }, ...r];
        }
    }
    return null;
}
function decompose(hand: Tid[], melds: Meld[]): { head: Tid | null; sets: SetPart[] } {
    const needed = 5 - melds.length; const sorted = sortHand(hand); const c = countMap(sorted);
    for (const h of Object.keys(c)) { if (c[h] < 2) continue; const rest = removeN(sorted, h, 2); const sets = extractSets(rest, needed); if (sets !== null) return { head: h, sets }; }
    return { head: null, sets: [] };
}
interface RoundInfo { windIdx: number; isDealer: boolean; honba: number; isRinshan: boolean; isHaitei: boolean; firstDraw: boolean; firstDiscard: boolean; }
function calcYaku(hand: Tid[], melds: Meld[], flowers: Tid[], winTile: Tid, winType: 'tsumo' | 'ron', pidx: number, ri: RoundInfo): { yaku: { name: string; tai: number }[]; total: number } {
    const yaku: { name: string; tai: number }[] = []; let tai = 0;
    const add = (name: string, tt: number) => { yaku.push({ name, tai: tt }); tai += tt; };
    const remove = (name: string) => { const i = yaku.findIndex(y => y.name === name); if (i >= 0) { tai -= yaku[i].tai; yaku.splice(i, 1); } };
    if (ri.firstDraw && ri.isDealer && winType === 'tsumo') { add('천화', 14); return { yaku, total: tai }; }
    if (ri.firstDiscard && !ri.isDealer && winType === 'ron') { add('지화', 14); return { yaku, total: tai }; }
    const isConcealed = melds.filter(m => m.type !== 'ankan').length === 0;
    const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
    if (winType === 'tsumo') add('츠모', 1);
    if (isConcealed) add('멘젠', 1);
    if (isConcealed && winType === 'tsumo') { remove('츠모'); remove('멘젠'); add('멘젠츠모', 3); }
    if (melds.length >= 4 && winType === 'ron') add('전구인', 2);
    const { head, sets } = decompose(hand, melds);
    const allTri = [...sets.filter(s => s.type === 'tri').map(s => s.tile), ...melds.filter(m => ['pon', 'minkan', 'addkan', 'ankan'].includes(m.type)).map(m => m.tiles[0])];
    if (allTiles.every(t => !'zf'.includes(suit(t)))) add('무자', 1);
    if (isConcealed) { const allSeq = sets.every(s => s.type === 'seq'); const hYaku = !!head && isYakuhai(head, pidx, ri.windIdx); const ts = isTwoSided(hand, winTile); if (allSeq && !hYaku && ts) add('핑후', 2); }
    const isTT = sets.length > 0 && sets.every(s => s.type === 'tri') && melds.every(m => ['pon', 'minkan', 'addkan', 'ankan'].includes(m.type)) && (sets.length + melds.length) >= 5;
    if (isTT) add('퐁퐁후', 4);  // 碰碰胡
    const concTri = sets.filter(s => s.type === 'tri').length + melds.filter(m => m.type === 'ankan').length;
    if (concTri >= 3) add('삼안커', 2);
    if (concTri >= 4) { remove('삼안커'); add('사안커', 7); }
    if (concTri >= 5) { remove('사안커'); add('오안커', 14); }
    for (const t of allTri) { const b = yakuhaiBonus(t, pidx, ri.windIdx); if (b > 0) add('역패(' + t + ')', b); }
    const dragons = ['z5', 'z6', 'z7']; const dTri = allTri.filter(t => dragons.includes(t)); const dHead = !!head && dragons.includes(head);
    if (dTri.length === 2 && dHead) add('소삼원', 7);
    if (dTri.length === 3) { remove('소삼원'); add('대삼원', 14); }
    const winds = ['z1', 'z2', 'z3', 'z4']; const wTri = allTri.filter(t => winds.includes(t)); const wHead = !!head && winds.includes(head);
    if (wTri.length === 3 && wHead) add('소사희', 7);
    if (wTri.length === 4) { remove('소사희'); add('대사희', 14); }
    // 一氣通貫: 한 색에서 123·456·789
    { const runStarts = [...sets.filter(s => s.type === 'seq').map(s => s.tile), ...melds.filter(m => m.type === 'chi').map(m => [...m.tiles].sort()[0])]; for (const su of ['m', 'p', 's']) if (runStarts.includes(su + '1') && runStarts.includes(su + '4') && runStarts.includes(su + '7')) { add('일기통관', 2); break; } }
    // 淸一色 8 / 混一色 4
    { const numSuits = new Set(allTiles.map(suit).filter(s => 'mps'.includes(s))); const hasHonor = allTiles.some(x => suit(x) === 'z'); if (numSuits.size === 1 && !hasHonor) { remove('무자'); add('청일색', 8); } else if (numSuits.size === 1 && hasHonor) add('혼일색', 4); }
    const anKC = melds.filter(m => m.type === 'ankan').length; const minKC = melds.filter(m => m.type === 'minkan' || m.type === 'addkan').length;
    if (anKC > 0) add('안깡×' + anKC, anKC * 2); if (minKC > 0) add('명깡×' + minKC, minKC);
    if (ri.isRinshan) add('영상개화', 1);
    if (ri.isHaitei && winType === 'tsumo') add('해저', 1);
    if (head === winTile && !isTwoSided(hand, winTile)) add('단기대기', 1);
    if (flowers.length === 8) return { yaku: [{ name: '화만관', tai: 14 }], total: 14 };
    if (flowers.length === 0) add('무화', 1);
    { const z = yaku.find(y => y.name === '무자'), hh = yaku.find(y => y.name === '무화'); if (z && hh) { remove('무자'); remove('무화'); add('무자무화', 2); } }
    const season = flowers.filter(f => num(f) <= 4); const plant = flowers.filter(f => num(f) >= 5);
    if (season.length === 4) add('춘하추동', 2); if (plant.length === 4) add('매난국죽', 2);
    const seatF = [[1, 5], [2, 6], [3, 7], [4, 8]][pidx] || [];
    for (const f of flowers) { if (seatF.includes(num(f))) add('정화(' + f + ')', 2); }
    if (ri.isDealer) add('친장가', 1);
    if (ri.honba > 0) add('본장×' + ri.honba, ri.honba * 2);
    return { yaku, total: Math.max(tai, 0) };
}

// ───────── 상태 ─────────
interface Meld { type: 'chi' | 'pon' | 'minkan' | 'addkan' | 'ankan'; tiles: Tid[]; from: number; claimed?: Tid; }
interface MJPlayer { id: string; nickname: string; seat: number; hand: Tid[]; melds: Meld[]; flowers: Tid[]; score: number; seatWind: number; isDealer: boolean; }
interface ClaimEntry { seat: number; options: string[]; }
interface MJState {
    players: MJPlayer[];
    wall: Tid[];
    discards: Tid[][];
    turn: number;                 // 'discard' 단계에서 차례인 좌석
    phase: 'discard' | 'claim' | 'over';
    lastDiscard: { tile: Tid; from: number } | null;
    claimQueue: ClaimEntry[];     // 우선순위 정렬, head = 현재 결정자
    claimIdx: number;
    lastDraw: Tid | null;
    round: { windIdx: number; dealer: number; honba: number };
    flags: { firstDraw: boolean; firstDiscard: boolean; isRinshan: boolean; isHaitei: boolean };
    finished: boolean; winnerId: string | null; result: GameResult | null;
    config: { timeLimit: number; bet: number };
}

// 반시계: 다음 좌석 = (s-1+4)%4, 카미차(치 가능 상가) = (s+1)%4
const nextSeat = (s: number) => (s + 3) % 4;
const prevSeat = (s: number) => (s + 1) % 4;

function seatById(state: MJState, id: string): number { return state.players.findIndex(p => p.id === id); }
function bri(state: MJState, seat: number): RoundInfo {
    const p = state.players[seat];
    return { windIdx: state.round.windIdx, isDealer: p.seatWind === 0, honba: state.round.honba, isRinshan: state.flags.isRinshan, isHaitei: state.flags.isHaitei, firstDraw: state.flags.firstDraw, firstDiscard: state.flags.firstDiscard };
}

// 화패 자동 보충
function processFlowers(state: MJState, seat: number): void {
    const p = state.players[seat]; let changed = true;
    while (changed) {
        changed = false;
        for (let i = p.hand.length - 1; i >= 0; i--) {
            if (isFlower(p.hand[i])) {
                p.flowers.push(p.hand.splice(i, 1)[0]);
                if (state.wall.length > 0) { const d = state.wall.shift()!; p.hand.push(d); if (isFlower(d)) changed = true; }
            }
        }
    }
}

// 점수 정산 (자모 -1 / 론 discarderSeat)
function settleWin(state: MJState, winnerSeat: number, discarderSeat: number, winTile: Tid, winType: 'tsumo' | 'ron'): void {
    const winner = state.players[winnerSeat];
    const res = calcYaku(winner.hand.filter(t => t !== '__win__'), winner.melds, winner.flowers, winTile, winType, winnerSeat, bri(state, winnerSeat));
    const tai = res.total;          // 표시 台 = 役 합산
    const payTai = tai + 5;         // 정산 = 役+5 (5台×U = 판돈 기본 포함)
    const isDW = winner.seatWind === 0;
    const pre = state.players.map(p => p.score);  // 판 시작 점수(증감 계산용)
    if (winType === 'tsumo') {
        const U = Math.round((state.config.bet || 100000) / 5);
        for (let p = 0; p < 4; p++) { if (p === winnerSeat) continue; const isDPay = state.players[p].seatWind === 0; const amt = (isDW || isDPay) ? payTai * U * 2 : payTai * U; state.players[p].score -= amt; winner.score += amt; }
    } else {
        const U = Math.round((state.config.bet || 100000) / 5); const isDPay = state.players[discarderSeat].seatWind === 0; const mult = (isDW || isDPay) ? 2 : 1; const amt = payTai * U * mult;
        state.players[discarderSeat].score -= amt; winner.score += amt;
    }
    state.finished = true; state.phase = 'over'; state.winnerId = winner.id;
    state.result = {
        winnerId: winner.id,
        scores: Object.fromEntries(state.players.map(p => [p.id, p.score])),
        reason: (winType === 'tsumo' ? '자모' : '론') + ' · ' + tai + '台',
    };
    (state.result as any).yaku = res.yaku;
    (state.result as any).tai = tai;
    (state.result as any).winType = winType;
    (state.result as any).winnerSeat = winnerSeat;
    (state.result as any).winTile = winTile;
    (state.result as any).discarderSeat = winType === 'ron' ? discarderSeat : -1;
    (state.result as any).discarderId = winType === 'ron' ? state.players[discarderSeat].id : null;
    (state.result as any).deltas = Object.fromEntries(state.players.map((p, i) => [p.id, p.score - pre[i]]));
}

function endDraw(state: MJState): void {
    state.finished = true; state.phase = 'over'; state.winnerId = null;
    state.result = { scores: Object.fromEntries(state.players.map(p => [p.id, p.score])), reason: '유국 (패 소진)' };
}

// 다음 드로워에게 진행 (자동 드로우 + 화패보충)
function advanceToDraw(state: MJState, fromSeat: number): void {
    const nx = nextSeat(fromSeat);
    state.turn = nx; state.phase = 'discard';
    state.lastDiscard = null; state.claimQueue = []; state.claimIdx = 0;
    if (state.wall.length === 0) { endDraw(state); return; }
    const p = state.players[nx];
    const d = state.wall.shift()!; p.hand.push(d); state.lastDraw = d;
    state.flags.isHaitei = state.wall.length === 0;
    state.flags.isRinshan = false;
    if (isFlower(d)) { p.flowers.push(p.hand.pop()!); processFlowers(state, nx); if (state.wall.length > 0) { const d2 = state.wall.shift()!; p.hand.push(d2); state.lastDraw = d2; } else { endDraw(state); return; } }
    p.hand = sortHand(p.hand);
}

// 깡 후 보충 (영상)
function kanReplace(state: MJState, seat: number): void {
    const p = state.players[seat]; state.flags.isRinshan = true;
    if (state.wall.length > 0) {
        p.hand.push(state.wall.shift()!);
        processFlowers(state, seat); // 보충패가 연속 화패여도 모두 처리
        p.hand = sortHand(p.hand);
    }
}

// 버린 패에 대한 클레임 큐 구성 (본인 제외)
function buildClaimQueue(state: MJState, tile: Tid, discarderSeat: number): ClaimEntry[] {
    const entries: { seat: number; options: string[]; prio: number }[] = [];
    for (let s = 0; s < 4; s++) {
        if (s === discarderSeat) continue;
        const p = state.players[s]; const opts: string[] = [];
        if (canWin([...p.hand, tile], p.melds)) opts.push('ron');
        if (canMinKan(p.hand, tile)) opts.push('kan');
        if (canPon(p.hand, tile)) opts.push('pon');
        // 치: 버린 사람이 내 카미차(바로 앞 차례)일 때만 = 내가 discarder의 다음 차례
        if (s === nextSeat(discarderSeat) && chiOptions(p.hand, tile).length > 0) opts.push('chi');
        if (opts.length === 0) continue;
        const prio = opts.includes('ron') ? 3 : (opts.includes('pon') || opts.includes('kan')) ? 2 : 1;
        entries.push({ seat: s, options: opts, prio });
    }
    entries.sort((a, b) => b.prio - a.prio);
    return entries.map(e => ({ seat: e.seat, options: e.options }));
}

// 클레임 적용
function applyClaim(state: MJState, seat: number, what: string, tiles: Tid[] | undefined, events: GameEvent[]): void {
    const tile = state.lastDiscard!.tile; const from = state.lastDiscard!.from;
    const p = state.players[seat];
    // 버린 패를 디스카드 풀에서 제거
    const di = state.discards[from]; const dIdx = di.lastIndexOf(tile); if (dIdx >= 0) di.splice(dIdx, 1);
    if (what === 'ron') {
        p.hand = [...p.hand, tile];
        settleWin(state, seat, from, tile, 'ron');
        events.push({ type: 'game_ended', payload: { winnerId: p.id, reason: state.result?.reason } });
        return;
    }
    if (what === 'pon') {
        let rm = 0; for (let i = p.hand.length - 1; i >= 0 && rm < 2; i--) if (p.hand[i] === tile) { p.hand.splice(i, 1); rm++; }
        p.melds.push({ type: 'pon', tiles: [tile, tile, tile], from, claimed: tile });
        state.turn = seat; state.phase = 'discard'; state.lastDiscard = null; state.claimQueue = []; state.lastDraw = null;
        events.push({ type: 'pon', playerId: p.id, payload: { tile } });
        return;
    }
    if (what === 'kan') {
        let rm = 0; for (let i = p.hand.length - 1; i >= 0 && rm < 3; i--) if (p.hand[i] === tile) { p.hand.splice(i, 1); rm++; }
        p.melds.push({ type: 'minkan', tiles: [tile, tile, tile, tile], from, claimed: tile });
        kanReplace(state, seat);
        state.turn = seat; state.phase = 'discard'; state.lastDiscard = null; state.claimQueue = [];
        events.push({ type: 'kan', playerId: p.id, payload: { tile } });
        return;
    }
    if (what === 'chi') {
        const opts = chiOptions(p.hand, tile);
        const chosen = (tiles && opts.find(o => [...o].sort().join() === [...tiles].sort().join())) || opts[0];
        for (const tt of chosen) { if (tt === tile) continue; const i = p.hand.indexOf(tt); if (i >= 0) p.hand.splice(i, 1); }
        p.melds.push({ type: 'chi', tiles: [...chosen].sort(), from, claimed: tile });
        state.turn = seat; state.phase = 'discard'; state.lastDiscard = null; state.claimQueue = []; state.lastDraw = null;
        events.push({ type: 'chi', playerId: p.id, payload: { tile } });
        return;
    }
}

// 클레임 큐에서 PASS 진행, 모두 패스면 다음 드로워로
function advanceClaim(state: MJState, events: GameEvent[]): void {
    state.claimIdx++;
    if (state.claimIdx >= state.claimQueue.length) {
        const from = state.lastDiscard!.from;
        advanceToDraw(state, from);
        events.push({ type: 'turn_advanced', payload: { nextSeat: state.turn } });
    }
}

// ───────── AI ─────────
function isoScore(tile: Tid, hand: Tid[]): number {
    const s = suit(tile), n = num(tile); if (s === 'f') return -100;
    if (s === 'z') return hand.filter(t => t === tile).length >= 2 ? -5 : 5;
    const nb = [s + (n - 2), s + (n - 1), s + (n + 1), s + (n + 2)].filter(t => num(t) >= 1 && num(t) <= 9);
    return -nb.filter(t => hand.includes(t)).length + (hand.filter(t => t === tile).length >= 2 ? -3 : 0) + (isTerminal(tile) ? 1 : 0);
}
function aiDiscard(hand: Tid[]): Tid { let worst = hand[hand.length - 1], ws = -Infinity; for (const t of hand) { const sc = isoScore(t, hand); if (sc > ws) { ws = sc; worst = t; } } return worst; }

// ───────── 플러그인 ─────────
export const mahjongPlugin: GamePlugin = {
    id: 'mahjong-tw',
    name: '대만 마작',
    minPlayers: 1,
    maxPlayers: 4,

    createInitialState(players: Player[], config?: any): MJState {
        const wall = shuffle(buildWall());
        const dealer = 0;
        // 좌석 배치: 제공된 플레이어를 .seat에 두고 빈 좌석은 ai-* 로 채움
        const bySeat: (Player | null)[] = [null, null, null, null];
        players.forEach((pl, i) => { const s = (typeof pl.seat === 'number' && pl.seat >= 0 && pl.seat < 4) ? pl.seat : i; bySeat[s] = pl; });
        const mjp: MJPlayer[] = [];
        for (let seat = 0; seat < 4; seat++) {
            const pl = bySeat[seat];
            mjp.push({
                id: pl ? pl.id : `ai-${seat}`,
                nickname: pl ? pl.nickname : `CPU ${['東', '南', '西', '北'][seat]}`,
                seat,
                hand: [], melds: [], flowers: [], score: 500000,
                seatWind: (seat - dealer + 4) % 4,
                isDealer: seat === dealer,
            });
        }
        const state: MJState = {
            players: mjp, wall, discards: [[], [], [], []],
            turn: dealer, phase: 'discard', lastDiscard: null, claimQueue: [], claimIdx: 0, lastDraw: null,
            round: { windIdx: 0, dealer, honba: 0 },
            flags: { firstDraw: true, firstDiscard: true, isRinshan: false, isHaitei: false },
            finished: false, winnerId: null, result: null,
            config: { timeLimit: config?.timeLimit ?? 20, bet: config?.bet ?? 100000 },
        };
        for (let s = 0; s < 4; s++) { const n = s === dealer ? 17 : 16; state.players[s].hand = state.wall.splice(0, n); }
        for (let s = 0; s < 4; s++) processFlowers(state, s);
        for (let s = 0; s < 4; s++) state.players[s].hand = sortHand(state.players[s].hand);
        return state;
    },

    validateAction(state: MJState, action: GameAction, playerId: string): ValidationResult {
        if (state.finished) return { valid: false, error: '게임 종료됨' };
        const seat = seatById(state, playerId);
        if (seat < 0) return { valid: false, error: '플레이어 없음' };
        if (state.phase === 'discard') {
            if (state.turn !== seat) return { valid: false, error: '당신의 턴이 아닙니다' };
            const p = state.players[seat];
            switch (action.type) {
                case 'DISCARD': {
                    const tile = action.payload?.tile;
                    if (!tile || !p.hand.includes(tile)) return { valid: false, error: '없는 패' };
                    return { valid: true };
                }
                case 'TSUMO':
                    return canWin(p.hand, p.melds) ? { valid: true } : { valid: false, error: '화료 불가' };
                case 'KAN': {
                    const kt = action.payload?.kanType;
                    if (kt === 'an') return canAnKan(p.hand).length > 0 ? { valid: true } : { valid: false, error: '안깡 불가' };
                    if (kt === 'add') { const addK = p.melds.filter(m => m.type === 'pon').map(m => m.tiles[0]).filter(t => p.hand.includes(t)); return addK.length > 0 ? { valid: true } : { valid: false, error: '가깡 불가' }; }
                    return { valid: false, error: '잘못된 깡' };
                }
                default: return { valid: false, error: `알 수 없는 액션: ${action.type}` };
            }
        }
        if (state.phase === 'claim') {
            const head = state.claimQueue[state.claimIdx];
            if (!head || head.seat !== seat) return { valid: false, error: '클레임 차례가 아닙니다' };
            if (action.type === 'PASS') return { valid: true };
            if (action.type === 'CLAIM') { const what = action.payload?.what; return head.options.includes(what) ? { valid: true } : { valid: false, error: '불가능한 클레임' }; }
            return { valid: false, error: `알 수 없는 액션: ${action.type}` };
        }
        return { valid: false, error: '진행 불가 단계' };
    },

    applyAction(state: MJState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as MJState;
        const events: GameEvent[] = [];
        const seat = seatById(newState, playerId);
        const p = newState.players[seat];

        if (newState.phase === 'discard' && newState.turn === seat) {
            if (action.type === 'DISCARD') {
                const tile = action.payload.tile;
                const i = p.hand.indexOf(tile); p.hand.splice(i, 1);
                newState.discards[seat].push(tile);
                newState.flags.firstDiscard = false; newState.flags.firstDraw = false; newState.lastDraw = null;
                newState.lastDiscard = { tile, from: seat };
                events.push({ type: 'discard', playerId, payload: { tile } });
                const q = buildClaimQueue(newState, tile, seat);
                if (q.length > 0) { newState.phase = 'claim'; newState.claimQueue = q; newState.claimIdx = 0; }
                else { advanceToDraw(newState, seat); events.push({ type: 'turn_advanced', payload: { nextSeat: newState.turn } }); }
                return { newState, events };
            }
            if (action.type === 'TSUMO') {
                const wt = newState.lastDraw || p.hand[p.hand.length - 1];
                settleWin(newState, seat, -1, wt, 'tsumo');
                events.push({ type: 'game_ended', payload: { winnerId: p.id, reason: newState.result?.reason } });
                return { newState, events };
            }
            if (action.type === 'KAN') {
                const kt = action.payload.kanType;
                if (kt === 'an') { const tile = canAnKan(p.hand)[0]; p.hand = p.hand.filter(t => t !== tile); p.melds.push({ type: 'ankan', tiles: [tile, tile, tile, tile], from: seat }); }
                else { const addK = p.melds.filter(m => m.type === 'pon').map(m => m.tiles[0]).filter(t => p.hand.includes(t)); const tile = addK[0]; const mi = p.melds.findIndex(m => m.type === 'pon' && m.tiles[0] === tile); if (mi >= 0) { p.melds[mi].type = 'addkan'; p.melds[mi].tiles.push(tile); } const i = p.hand.indexOf(tile); if (i >= 0) p.hand.splice(i, 1); }
                kanReplace(newState, seat); newState.lastDraw = null;
                events.push({ type: 'kan', playerId, payload: { kanType: kt } });
                return { newState, events };
            }
        }

        if (newState.phase === 'claim') {
            const head = newState.claimQueue[newState.claimIdx];
            if (head && head.seat === seat) {
                if (action.type === 'PASS') { events.push({ type: 'claim_pass', playerId }); advanceClaim(newState, events); return { newState, events }; }
                if (action.type === 'CLAIM') { applyClaim(newState, seat, action.payload.what, action.payload.tiles, events); return { newState, events }; }
            }
        }
        return { newState, events };
    },

    getCurrentTurn(state: MJState): string | null {
        if (state.finished) return null;
        if (state.phase === 'claim') { const head = state.claimQueue[state.claimIdx]; return head ? state.players[head.seat].id : null; }
        return state.players[state.turn]?.id || null;
    },

    isGameOver(state: MJState): boolean { return state.finished; },

    getResult(state: MJState): GameResult | null { return state.finished ? state.result : null; },

    getPublicState(state: MJState): any {
        return {
            players: state.players.map(p => ({
                id: p.id, nickname: p.nickname, seat: p.seat, seatWind: p.seatWind, isDealer: p.isDealer,
                handCount: p.hand.length, melds: p.melds, flowers: p.flowers, score: p.score,
                tenpai: !state.finished && isTenpai(p.hand, p.melds),
            })),
            discards: state.discards,
            turn: state.turn, phase: state.phase,
            lastDiscard: state.lastDiscard,
            claim: state.phase === 'claim' ? { seat: state.claimQueue[state.claimIdx]?.seat, options: state.claimQueue[state.claimIdx]?.options } : null,
            wallCount: state.wall.length,
            round: state.round,
            finished: state.finished, winnerId: state.winnerId, result: state.result,
            config: state.config,
            lastSteps: (state as any).lastSteps, stepGen: (state as any).stepGen,
        };
    },

    getPlayerView(state: MJState, playerId: string): any {
        const seat = seatById(state, playerId);
        const me = seat >= 0 ? state.players[seat] : null;
        const pub = this.getPublicState(state);
        // 내 차례에 가능한 액션 힌트
        let myActions: any = null;
        if (me) {
            if (state.phase === 'discard' && state.turn === seat) {
                myActions = { canDiscard: true, canTsumo: canWin(me.hand, me.melds), ankan: canAnKan(me.hand), addkan: me.melds.filter(m => m.type === 'pon').map(m => m.tiles[0]).filter(t => me.hand.includes(t)) };
            } else if (state.phase === 'claim') {
                const head = state.claimQueue[state.claimIdx];
                if (head && head.seat === seat) myActions = { claim: head.options, tile: state.lastDiscard?.tile, chiOptions: head.options.includes('chi') ? chiOptions(me.hand, state.lastDiscard!.tile) : [] };
            }
        }
        return {
            ...pub,
            mySeat: seat,
            myHand: me ? sortHand(me.hand) : [],
            myFlowers: me ? me.flowers : [],
            lastDraw: (me && state.turn === seat) ? state.lastDraw : null,
            isMyTurn: state.phase === 'discard' && state.turn === seat,
            myActions,
        };
    },

    getTimeoutAction(state: MJState, playerId: string): GameAction | null {
        if (state.finished) return null;
        const seat = seatById(state, playerId);
        if (seat < 0) return null;
        if (state.phase === 'discard' && state.turn === seat) {
            const p = state.players[seat];
            return { type: 'DISCARD', payload: { tile: state.lastDraw || p.hand[p.hand.length - 1] } };
        }
        if (state.phase === 'claim' && state.claimQueue[state.claimIdx]?.seat === seat) return { type: 'PASS' };
        return null;
    },

    getAIAction(state: MJState, playerId: string): GameAction {
        const seat = seatById(state, playerId);
        const p = state.players[seat];
        if (state.phase === 'claim' && state.claimQueue[state.claimIdx]?.seat === seat) {
            const opts = state.claimQueue[state.claimIdx].options;
            const tile = state.lastDiscard?.tile;
            if (opts.includes('ron')) return { type: 'CLAIM', payload: { what: 'ron' } };
            if (opts.includes('kan') && Math.random() < 0.6) return { type: 'CLAIM', payload: { what: 'kan' } };
            if (opts.includes('pon')) {
                const yk = !!tile && isYakuhai(tile, seat, state.round.windIdx);
                if (yk || Math.random() < 0.4) return { type: 'CLAIM', payload: { what: 'pon' } };
            }
            if (opts.includes('chi') && tile && Math.random() < 0.25) {
                const co = chiOptions(p.hand, tile);
                if (co.length) return { type: 'CLAIM', payload: { what: 'chi', tiles: co[0] } };
            }
            return { type: 'PASS' };
        }
        if (state.phase === 'discard' && state.turn === seat) {
            const ak = canAnKan(p.hand);
            if (ak.length > 0 && Math.random() < 0.5) return { type: 'KAN', payload: { kanType: 'an' } };
            const addK = p.melds.filter(m => m.type === 'pon').map(m => m.tiles[0]).filter(t => p.hand.includes(t));
            if (addK.length > 0 && Math.random() < 0.5) return { type: 'KAN', payload: { kanType: 'add' } };
            if (canWin(p.hand, p.melds)) return { type: 'TSUMO' };
            return { type: 'DISCARD', payload: { tile: aiDiscard(p.hand) } };
        }
        return { type: 'PASS' };
    },
};
