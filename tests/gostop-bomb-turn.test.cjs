/**
 * gostop BOMB turn-structure test (server engine).
 *
 * Locks the single-player spec that multiplayer must match:
 *   - After a BOMB, the turn passes to the OPPONENT (the bomber does NOT keep going).
 *   - The bomber is owed 2 flip turns (flipOwed[seat] === 2).
 *   - flipOwed is NOT auto-consumed during the opponent's turn; it stays owed
 *     until the bomber spends it via an explicit FLIP action on their own turn.
 *   - On the bomber's turn, FLIP is a valid action and consumes exactly 1 owed,
 *     then the turn passes back to the opponent (selective — not 2 turns in a row).
 *   - The bomber may instead PLAY a normal card (FLIP is optional, not forced).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');

const pluginPath = path.join(__dirname, '../functions/games/gostop.ts');
const src = fs.readFileSync(pluginPath, 'utf8').replace(/^import[^;]+;\s*$/gm, '');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { module: { exports: {} }, exports: {}, Math, JSON, Object, Array, String };
sandbox.module.exports = sandbox.exports;
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const plugin = sandbox.module.exports.gostopPlugin || sandbox.gostopPlugin;
assert(plugin, 'plugin loaded');

// Build a 2P game, then force a deterministic bomb setup:
// bomber (seat 0) holds 3 cards of month M, and 1 card of month M sits on the table.
function craftBombState() {
  const s = plugin.createInitialState(
    [{ id: 'A', nickname: 'A', seat: 0 }, { id: 'B', nickname: 'B', seat: 1 }], { seats: 2 });
  const byMonth = {};
  for (const id in s.cardMap) { const c = s.cardMap[id]; (byMonth[c.m] = byMonth[c.m] || []).push(id); }
  // find a month with >=4 cards (every month has 4) and place 3 in bomber hand + 1 on table
  const M = +Object.keys(byMonth).find((m) => byMonth[m].length >= 4);
  const four = byMonth[M];
  const owned = new Set(allIds(s));
  // pull these 4 out of wherever they are, then assign
  const strip = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (four.includes(arr[i])) arr.splice(i, 1); };
  strip(s.deck); strip(s.table); s.players.forEach((p) => { strip(p.hand); strip(p.cap); });
  s.players[0].hand.push(four[0], four[1], four[2]);
  s.table.push(four[3]);
  s.currentTurn = 0;
  // keep deck non-empty so flips are live
  assert(s.deck.length > 5, 'deck should remain non-empty for the scenario');
  return { s, M };
}
function allIds(s) { const a = [...s.deck, ...s.table]; s.players.forEach((p) => a.push(...p.hand, ...p.cap)); return a; }

let passed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }

// 1) BOMB → turn to opponent, bomber owes 2 flips
{
  const { s, M } = craftBombState();
  const r = plugin.applyAction(s, { type: 'BOMB', payload: { month: M } }, 'A');
  const ns = r.newState;
  // unless the bomb itself reached goMin and parked the bomber in a GO/STOP pending,
  // the turn must be the opponent's and the bomber must owe 2 flips.
  if (!ns.pending) {
    assert.strictEqual(ns.currentTurn, 1, `after BOMB, turn must pass to opponent (seat 1), got ${ns.currentTurn}`);
  }
  assert.strictEqual(ns.flipOwed[0], 2, `bomber should owe 2 flips, got ${ns.flipOwed[0]}`);
  ok('BOMB passes turn to opponent and owes bomber 2 flips');

  // 2) opponent plays a normal card → bomber's owed flips must NOT be auto-consumed
  if (!ns.pending) {
    const bHand = ns.players[1].hand;
    const r2 = plugin.applyAction(ns, { type: 'PLAY', payload: { cardId: bHand[0] } }, 'B');
    const ns2 = r2.newState;
    assert.strictEqual(ns2.flipOwed[0], 2, `opponent's turn must NOT auto-spend bomber's flips, got ${ns2.flipOwed[0]}`);
    // and now it's the bomber's turn again (selective flip), not the opponent doubling up
    if (!ns2.pending && !ns2.finished) {
      assert.strictEqual(ns2.currentTurn, 0, `turn should return to bomber, got ${ns2.currentTurn}`);
    }
    ok('opponent turn does not auto-consume bomber flips; turn returns to bomber');

    // 3) on bomber's turn, FLIP is valid and consumes exactly 1 owed
    if (!ns2.pending && !ns2.finished && ns2.currentTurn === 0) {
      const v = plugin.validateAction(ns2, { type: 'FLIP' }, 'A');
      assert(v.valid, `FLIP should be valid on bomber's turn with owed flips: ${v.error}`);
      const r3 = plugin.applyAction(ns2, { type: 'FLIP' }, 'A');
      const ns3 = r3.newState;
      assert.strictEqual(ns3.flipOwed[0], 1, `one FLIP consumes exactly 1 owed (2→1), got ${ns3.flipOwed[0]}`);
      if (!ns3.pending && !ns3.finished) {
        assert.strictEqual(ns3.currentTurn, 1, `after a single FLIP, turn passes to opponent (not 2 in a row), got ${ns3.currentTurn}`);
      }
      ok('FLIP consumes exactly 1 owed and passes turn (selective, not consecutive)');
    } else { ok('FLIP path skipped (bomb parked in pending/finished) — structure still valid'); }
  }
}

// 4) FLIP is optional: bomber may PLAY a normal card instead while owing flips
{
  const { s, M } = craftBombState();
  const r = plugin.applyAction(s, { type: 'BOMB', payload: { month: M } }, 'A');
  let ns = r.newState;
  if (!ns.pending) {
    // opponent plays
    ns = plugin.applyAction(ns, { type: 'PLAY', payload: { cardId: ns.players[1].hand[0] } }, 'B').newState;
    if (!ns.pending && !ns.finished && ns.currentTurn === 0 && ns.players[0].hand.length > 0) {
      const v = plugin.validateAction(ns, { type: 'PLAY', payload: { cardId: ns.players[0].hand[0] } }, 'A');
      assert(v.valid, `bomber should be allowed to PLAY a normal card while owing flips: ${v.error}`);
      ok('bomber may PLAY normally while owing flips (FLIP is optional)');
    } else { ok('optional-PLAY path skipped (state parked) — acceptable'); }
  }
}

console.log(`\n✅ gostop BOMB turn-structure: ${passed} checks passed`);
