/**
 * ppingpae server plugin behavior test
 *
 * Transpiles the TS plugin on the fly and exercises the game loop:
 *   - createInitialState deals 14 tiles per player
 *   - COMPLETE_TURN validates conservation, validity, 30점 룰
 *   - PASS draws a tile and rotates the turn
 *   - View filtering hides others' hands and drawpile contents
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');

const pluginPath = path.join(__dirname, '../functions/games/ppingpae.ts');
const src = fs.readFileSync(pluginPath, 'utf8');

// strip the import line and the type-only imports we don't need
const stripped = src.replace(/^import[^;]+;\s*$/gm, '');
const js = ts.transpileModule(stripped, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

const sandbox = { module: { exports: {} }, exports: {}, require, console };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const { ppingpaePlugin, isValidRun, isValidGroup, validateCompleteTurn } = sandbox.module.exports;

assert(ppingpaePlugin, 'ppingpaePlugin exported');
assert.equal(ppingpaePlugin.id, 'ppingpae');
assert.equal(ppingpaePlugin.minPlayers, 2);
assert.equal(ppingpaePlugin.maxPlayers, 4);

// ─── 검증 함수 단위 ───────────────────────────────
// 조커 끝 확장
assert(isValidRun([
    { id: 'a', color: 'red', number: 5, isJoker: false },
    { id: 'b', color: 'red', number: 6, isJoker: false },
    { id: 'j', color: 'joker', number: 0, isJoker: true },
]), '[red5, red6, joker]는 유효 (5-6-7)');

assert(!isValidRun([
    { id: 'a', color: 'red', number: 1, isJoker: false },
    { id: 'b', color: 'red', number: 13, isJoker: false },
    { id: 'j', color: 'joker', number: 0, isJoker: true },
]), '[red1, red13, joker]는 범위 초과로 무효');

assert(isValidGroup([
    { id: 'a', color: 'red', number: 3, isJoker: false },
    { id: 'b', color: 'black', number: 3, isJoker: false },
    { id: 'j', color: 'joker', number: 0, isJoker: true },
]), '[red3, black3, joker]는 유효 그룹');

// ─── 초기 상태 ───────────────────────────────
const players = [
    { id: 'u1', nickname: 'Alice', seat: 0 },
    { id: 'u2', nickname: 'Bob', seat: 1 },
];
const state = ppingpaePlugin.createInitialState(players, {});
assert.equal(state.players.length, 2);
assert.equal(state.players[0].handIds.length, 14, '초기 손패 14장');
assert.equal(state.players[1].handIds.length, 14);
// 총 타일: 4색 × 13숫자 × 2장 + 조커 2 = 106
const totalTiles = state.drawPile.length + state.players.reduce((s, p) => s + p.handIds.length, 0);
assert.equal(totalTiles, 106, '총 타일 106장');
assert(Object.keys(state.tileMap).length === 106, 'tileMap에 106장');

// ─── 잘못된 턴 ───────────────────────────────
const r1 = ppingpaePlugin.validateAction(state, { type: 'COMPLETE_TURN', payload: { board: [], handIds: state.players[1].handIds } }, 'u2');
assert(!r1.valid && r1.error.includes('당신의 턴'), '다른 플레이어 턴에 액션 거부');

// ─── COMPLETE_TURN: 타일 보존 위반 ───────────────────────────────
const aliceHand = state.players[0].handIds;
const fakeBoard = [{ gid: 0, tileIds: ['fake_tile_id'] }];
const r2 = ppingpaePlugin.validateAction(state, { type: 'COMPLETE_TURN', payload: { board: fakeBoard, handIds: aliceHand } }, 'u1');
assert(!r2.valid, '존재하지 않는 타일은 무효');

// ─── 보드에서 손패로 끌어오기 시도 차단 ───────────────────────────────
// 우선 보드에 그룹 하나 강제로 둠
const seedState = JSON.parse(JSON.stringify(state));
const someTileIds = aliceHand.slice(0, 3);
seedState.board.push({ gid: 1, tileIds: someTileIds });
seedState.players[0].handIds = aliceHand.slice(3);
const r3 = ppingpaePlugin.validateAction(seedState, {
    type: 'COMPLETE_TURN',
    payload: { board: [], handIds: [...seedState.players[0].handIds, ...someTileIds] },
}, 'u1');
assert(!r3.valid && r3.error.includes('손패로'), '보드 타일을 손패로 가져오는 동작 차단');

function pickOnePerColor(tiles, number) {
    const out = [];
    for (const color of ['black', 'red', 'blue']) {
        const found = tiles.find(t => !t.isJoker && t.number === number && t.color === color);
        if (found) out.push(found);
    }
    return out;
}

// ─── 30점 미달 차단 ───────────────────────────────
const lowState = ppingpaePlugin.createInitialState(players, {});
const tiles = Object.values(lowState.tileMap);
const ones = pickOnePerColor(tiles, 1); // 3점
const usedIds = new Set([...ones.map(t => t.id), ...lowState.players[1].handIds]);
const others = tiles.filter(t => !usedIds.has(t.id)).slice(0, 14 - ones.length);
lowState.players[0].handIds = [...ones.map(t => t.id), ...others.map(t => t.id)];
const playedGroup = ones.map(t => t.id);
const remainHand = lowState.players[0].handIds.filter(id => !playedGroup.includes(id));
const r4 = ppingpaePlugin.validateAction(lowState, {
    type: 'COMPLETE_TURN',
    payload: { board: [{ gid: 0, tileIds: playedGroup }], handIds: remainHand },
}, 'u1');
assert(!r4.valid && r4.error.includes('30점'), `초기 출전 30점 미달 차단 — got ${JSON.stringify(r4)}`);

// ─── 정상 COMPLETE_TURN: 30점 이상 그룹 ───────────────────────────────
const okState = ppingpaePlugin.createInitialState(players, {});
const okTiles = Object.values(okState.tileMap);
const tens = pickOnePerColor(okTiles, 10); // 30점
assert.equal(tens.length, 3, 'three different-color 10 tiles available');
const okUsed = new Set([...tens.map(t => t.id), ...okState.players[1].handIds]);
const fillers = okTiles.filter(t => !okUsed.has(t.id)).slice(0, 14 - tens.length);
okState.players[0].handIds = [...tens.map(t => t.id), ...fillers.map(t => t.id)];
const okPlayed = tens.map(t => t.id);
const okRemainHand = okState.players[0].handIds.filter(id => !okPlayed.includes(id));
const validation = ppingpaePlugin.validateAction(okState, {
    type: 'COMPLETE_TURN',
    payload: { board: [{ gid: 0, tileIds: okPlayed }], handIds: okRemainHand },
}, 'u1');
assert(validation.valid, `30점 그룹 통과해야: ${validation.error || 'OK'}`);

const applied = ppingpaePlugin.applyAction(okState, {
    type: 'COMPLETE_TURN',
    payload: { board: [{ gid: 0, tileIds: okPlayed }], handIds: okRemainHand },
}, 'u1');
assert.equal(applied.newState.board.length, 1, 'applyAction이 보드에 그룹 1개');
assert.equal(applied.newState.players[0].handIds.length, 11, '손패 14→11');
assert(applied.newState.players[0].hasInitialMeld, '초기 출전 플래그 set');
assert.equal(applied.newState.currentTurn, 1, '턴 회전');
assert(applied.events.some(e => e.type === 'turn_committed'), 'turn_committed 이벤트');

// ─── PASS 액션 ───────────────────────────────
const passResult = ppingpaePlugin.applyAction(okState, { type: 'PASS' }, 'u1');
assert.equal(passResult.newState.players[0].handIds.length, 15, 'PASS 시 1장 드로우');
assert.equal(passResult.newState.consecutivePasses, 1);
assert.equal(passResult.newState.currentTurn, 1, '턴 회전');

// ─── View 필터링 ───────────────────────────────
const pubView = ppingpaePlugin.getPublicState(okState);
assert(pubView.players[0].handCount === 14, '퍼블릭에는 handCount만');
assert(!pubView.players[0].handIds, '퍼블릭에는 handIds 없음');
assert(typeof pubView.drawPileCount === 'number', '드로우 파일 카운트');
assert(!pubView.drawPile, '드로우 파일 ids 비공개');

const aliceView = ppingpaePlugin.getPlayerView(okState, 'u1');
assert(Array.isArray(aliceView.myHand) && aliceView.myHand.length === 14, '본인 손패 14장 노출');
assert(aliceView.isMyTurn === true);
const bobView = ppingpaePlugin.getPlayerView(okState, 'u2');
assert(bobView.isMyTurn === false);
assert(bobView.myHand.length === 14, 'Bob 자기 손패 보임');

console.log('PASS ppingpae server plugin behavior');
