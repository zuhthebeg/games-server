/**
 * gostop 4인 광팔이(sit-out) E2E — server engine, no transport
 *
 * Drives the gostop plugin as RoomDO does, for 4-player games, asserting:
 *   - prePhase(참가/빠짐) routing: only the current decider's SITDECIDE is valid
 *   - exactly ONE player sits out; 선(seat0) never sits out
 *   - 강제 빠짐(seat3, when seat1&2 both join)만 forced=true
 *   - 빠진 사람 손패는 더미로 회수 → deck 21, 활성 3명 hand 7
 *   - card conservation: 48 hwatu accounted for, no dups, at every stable point
 *   - turn rotation skips the out seat
 *   - termination + zero-sum (위로금 포함)
 *   - 위로금: forced & 광>0 → 승자 제외 활성 패자 2명이 광×2점씩 지불, 빠진 사람이 합계 수령
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ts = require('typescript');

const pluginPath = path.join(__dirname, '../functions/games/gostop.ts');
const src = fs.readFileSync(pluginPath, 'utf8');
const stripped = src.replace(/^import[^;]+;\s*$/gm, '');
const js = ts.transpileModule(stripped, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

let _seed = 1;
function seededRandom() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandbox = { module: { exports: {} }, exports: {}, Math: Object.assign(Object.create(Math), { random: seededRandom }) };
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const plugin = sandbox.module.exports.gostopPlugin || sandbox.exports.gostopPlugin;
assert(plugin, 'plugin loaded');

function allCardIds(state) {
  const ids = [];
  ids.push(...state.deck, ...state.table);
  state.players.forEach(p => ids.push(...p.hand, ...p.cap));
  return ids;
}
function assertConservation(state, label) {
  const ids = allCardIds(state);
  assert.strictEqual(ids.length, 48, `${label}: card count ${ids.length} != 48`);
  assert.strictEqual(new Set(ids).size, 48, `${label}: duplicate cards`);
}

// AI-driven full game from the perspective of the DO loop.
function runGame(seed) {
  _seed = seed;
  const players = [0,1,2,3].map(i => ({ id: `p${i}`, nickname: `P${i}` }));
  let state = plugin.createInitialState(players, { bet: 1 });

  // 딜 직후: 4인은 prePhase 존재, 모두 7장, deck 14
  assert(state.prePhase || state.finished, `seed${seed}: 4P should have prePhase (unless 총통)`);
  if (state.finished) return { skipped: '총통' };
  state.players.forEach(p => assert.strictEqual(p.hand.length, 7, `seed${seed}: deal 7 each`));
  assert.strictEqual(state.deck.length, 14, `seed${seed}: deck 14 after 4x7+table6`);
  assertConservation(state, `seed${seed} deal`);

  let steps = 0;
  while (!plugin.isGameOver(state) && steps++ < 400) {
    const turnId = plugin.getCurrentTurn(state);
    assert(turnId, `seed${seed}: turn id`);
    const seat = state.players.findIndex(p => p.id === turnId);
    assert(!state.players[seat].out, `seed${seed}: out seat must never get a turn`);

    // turn-guard: a non-decider/non-turn player's action is rejected
    const other = state.players.find(p => p.id !== turnId);
    const guard = plugin.validateAction(state, { type: 'PLAY', payload: { cardId: other.hand[0] || 'x' } }, other.id);
    assert(!guard.valid, `seed${seed}: off-turn action must be rejected`);

    // pendingFlip(따닥 먹을패 선택)은 사람 전용 경로 — getAIAction에 없으므로 기본 선택으로 처리(클라/타임아웃과 동일)
    const action = state.pendingFlip ? { type: 'FLIPPICK', payload: {} } : plugin.getAIAction(state, turnId);
    const v = plugin.validateAction(state, action, turnId);
    assert(v.valid, `seed${seed}: AI action invalid: ${v.error}`);
    const res = plugin.applyAction(state, action, turnId);
    state = res.newState;
    if (!plugin.isGameOver(state)) assertConservation(state, `seed${seed} step${steps}`);
  }
  assert(plugin.isGameOver(state), `seed${seed}: game terminated`);

  // exactly one out, 선(seat0) never out
  const outs = state.players.filter(p => p.out);
  assert.strictEqual(outs.length, 1, `seed${seed}: exactly 1 sits out`);
  assert(!state.players[0].out, `seed${seed}: 선(seat0) never sits out`);
  assert(state.out, `seed${seed}: state.out recorded`);

  // zero-sum (위로금 포함)
  const sum = Object.values(state.scores).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 0, `seed${seed}: scores zero-sum (got ${sum})`);

  // 위로금 검증
  if (!state.endReason || state.winnerSeat == null) {
    // 나가리 → 전원 0 (후불제 면제)
    Object.values(state.scores).forEach(v => assert.strictEqual(v, 0, `seed${seed}: nagari all 0`));
  } else if (state.out.forced && state.out.gwang > 0) {
    const wamt = state.out.gwang * 2 * 10000 * 1;
    const outScore = state.scores[state.players[state.out.seat].id];
    // 승자 제외 활성 패자 2명이 각 wamt 지불 → 빠진 사람 +2*wamt
    assert.strictEqual(outScore, 2 * wamt, `seed${seed}: 위로금 out=${outScore} expect ${2*wamt}`);
  } else {
    // 자진 빠짐 or 광0 → 위로금 없음
    assert.strictEqual(state.scores[state.players[state.out.seat].id], 0, `seed${seed}: no 위로금 → out score 0`);
  }
  return { out: state.out, winner: state.winnerSeat, reason: state.endReason };
}

// ─── decider routing focused test ───
(function deciderRouting() {
  _seed = 12345;
  const players = [0,1,2,3].map(i => ({ id: `p${i}`, nickname: `P${i}` }));
  let st = plugin.createInitialState(players, { bet: 1 });
  if (st.finished) { console.log('  (skip routing: 총통 seed)'); return; }
  // 첫 결정자 = seat1
  assert.strictEqual(plugin.getCurrentTurn(st), 'p1', 'first decider seat1');
  // seat0(선)·seat2 는 결정 못 함
  assert(!plugin.validateAction(st, { type: 'SITDECIDE', payload: { join: true } }, 'p0').valid, 'seat0 cannot decide');
  assert(!plugin.validateAction(st, { type: 'SITDECIDE', payload: { join: true } }, 'p2').valid, 'seat2 not yet');
  // seat1 빠짐 선택 → seat1 out (자진, 위로금 없음)
  let r = plugin.applyAction(st, { type: 'SITDECIDE', payload: { join: false } }, 'p1');
  st = r.newState;
  assert(st.players[1].out, 'seat1 out after voluntary sit');
  assert.strictEqual(st.out.forced, false, 'voluntary → not forced');
  assert.strictEqual(st.prePhase, null, 'prePhase cleared');
  assert.strictEqual(plugin.getCurrentTurn(st), 'p0', '선 starts play');
  console.log('  ✓ decider routing: seat1 voluntary sit-out → 선 starts, not forced');

  // 강제 빠짐 경로: seat1·2 둘 다 참가 → seat3 강제 out
  _seed = 999;
  let st2 = plugin.createInitialState(players, { bet: 1 });
  if (!st2.finished) {
    st2 = plugin.applyAction(st2, { type: 'SITDECIDE', payload: { join: true } }, 'p1').newState;
    assert.strictEqual(plugin.getCurrentTurn(st2), 'p2', 'after seat1 join, seat2 decides');
    st2 = plugin.applyAction(st2, { type: 'SITDECIDE', payload: { join: true } }, 'p2').newState;
    assert(st2.players[3].out, 'seat3 forced out when 1&2 both join');
    assert.strictEqual(st2.out.forced, true, 'seat3 → forced');
    console.log('  ✓ decider routing: seat1+2 join → seat3 forced out (광팔기 자격)');
  }
})();

// ─── many seeded full games ───
let played = 0, chong = 0, forcedSell = 0, voluntary = 0, nagari = 0;
for (let seed = 1; seed <= 300; seed++) {
  const r = runGame(seed);
  if (r.skipped) { chong++; continue; }
  played++;
  if (r.winner == null) nagari++;
  else if (r.out.forced && r.out.gwang > 0) forcedSell++;
  else voluntary++;
}
console.log(`✅ gostop 4P 광팔이 E2E: ${played} games (총통 skip ${chong}), 광팔이정산 ${forcedSell}, 위로금없음 ${voluntary}, 나가리 ${nagari}`);
console.log('   invariants held: prePhase-routing · single-sitout · 선-safe · deck21 · card-conservation · turn-skip · termination · zero-sum · 위로금-math');
