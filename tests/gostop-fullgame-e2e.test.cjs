/**
 * gostop full-game E2E (server engine, no transport)
 *
 * Drives the gostop plugin end-to-end exactly as RoomDO does
 * (validateAction → applyAction → repeat), for both 2P and 3P,
 * across many seeded games, asserting the invariants that matter:
 *
 *   - turn guard: off-turn / wrong-phase actions are rejected (state unchanged)
 *   - illegal moves: card not in hand is rejected
 *   - hand privacy: a player's view never exposes opponents' hands (handCount only)
 *   - card conservation: at every stable point the 48 hwatu are all accounted for, no dups
 *   - phase routing: pending(GO/STOP) and pendingFlip(FLIPPICK) are handled
 *   - termination: every game finishes within a sane step bound
 *   - zero-sum: final scores sum to 0
 *   - getResult: winner is consistent with finished state
 *
 * Math.random is replaced by a seeded LCG so each game is reproducible;
 * a failing seed is printed so it can be rerun in isolation.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');

const pluginPath = path.join(__dirname, '../functions/games/gostop.ts');
const src = fs.readFileSync(pluginPath, 'utf8');
// drop the type-only import; everything else is self-contained
const stripped = src.replace(/^import[^;]+;\s*$/gm, '');
const js = ts.transpileModule(stripped, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

// --- seeded Math.random the sandbox shares (LCG) ---
let _seed = 1;
function seededRandom() {
  // mulberry32
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandboxMath = Object.create(Math);
sandboxMath.random = seededRandom;

const sandbox = { module: { exports: {} }, exports: {}, Math: sandboxMath, JSON, Object, Array, String };
sandbox.module.exports = sandbox.exports;
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const plugin = sandbox.module.exports.gostopPlugin || sandbox.gostopPlugin;
assert(plugin && typeof plugin.applyAction === 'function', 'plugin loaded');

const DECK_SIZE = 48;

function allCardIds(state) {
  const ids = [];
  ids.push(...state.deck, ...state.table);
  for (const p of state.players) { ids.push(...p.hand, ...p.cap); }
  return ids;
}

function assertConserved(state, ctx) {
  const ids = allCardIds(state);
  const set = new Set(ids);
  assert.strictEqual(set.size, ids.length, `${ctx}: duplicate card id detected`);
  assert.strictEqual(ids.length, DECK_SIZE, `${ctx}: expected ${DECK_SIZE} cards, got ${ids.length}`);
}

function assertPrivacy(state, viewerId, ctx) {
  const view = plugin.getPlayerView(state, viewerId);
  for (const p of view.players) {
    if (p.id === viewerId) continue;
    assert.strictEqual(p.hand, undefined, `${ctx}: opponent ${p.id} hand leaked in view of ${viewerId}`);
    assert.strictEqual(typeof p.handCount, 'number', `${ctx}: opponent ${p.id} missing handCount`);
  }
}

// pick a legal action for whoever is on turn — mirrors RoomDO.runAI + FLIPPICK handling
function nextAction(state, turnId) {
  const seat = state.players.findIndex((p) => p.id === turnId);
  if (state.pendingFlip && state.pendingFlip.seat === seat) {
    return { type: 'FLIPPICK', payload: {} }; // empty → engine picks best candidate
  }
  return plugin.getAIAction(state, turnId);
}

function playOneGame(seed, seats) {
  _seed = seed;
  const humans = [];
  for (let i = 0; i < Math.min(seats, 2); i++) humans.push({ id: `p${i}`, nickname: `P${i}` });
  let state = plugin.createInitialState(humans, { seats });

  // 총통 (instant win on deal) is a valid terminal — accept it
  if (plugin.isGameOver(state)) {
    assertConserved(state, `seed=${seed} dealt-chong`);
    return { state, steps: 0, chong: true };
  }

  let steps = 0;
  const MAX = 4000;
  while (!plugin.isGameOver(state) && steps < MAX) {
    steps++;
    const turnId = plugin.getCurrentTurn(state);
    assert(turnId, `seed=${seed} step=${steps}: no current turn while game live`);
    const seat = state.players.findIndex((p) => p.id === turnId);

    const stable = !state.pending && !state.pendingFlip;
    if (stable) assertConserved(state, `seed=${seed} step=${steps}`);

    // privacy holds for every player at every step
    for (const p of state.players) assertPrivacy(state, p.id, `seed=${seed} step=${steps}`);

    // turn guard: a different player cannot act in this phase
    const other = state.players.find((p) => p.id !== turnId);
    if (other) {
      const probe = stable
        ? { type: 'PLAY', payload: { cardId: state.players[seat].hand[0] } } // a card the prober doesn't even hold
        : { type: state.pending ? 'GO' : 'FLIPPICK', payload: {} };
      const guard = plugin.validateAction(state, probe, other.id);
      assert.strictEqual(guard.valid, false, `seed=${seed} step=${steps}: off-turn action by ${other.id} was accepted`);
    }

    // illegal card: in stable PLAY phase, a card not in hand must be rejected
    if (stable) {
      const bogus = plugin.validateAction(state, { type: 'PLAY', payload: { cardId: 'no_such_card' } }, turnId);
      assert.strictEqual(bogus.valid, false, `seed=${seed} step=${steps}: bogus card accepted`);
    }

    const action = nextAction(state, turnId);
    const v = plugin.validateAction(state, action, turnId);
    assert.strictEqual(v.valid, true, `seed=${seed} step=${steps}: engine-generated action rejected: ${v.error} :: ${JSON.stringify(action)}`);
    const res = plugin.applyAction(state, action, turnId);
    assert(res && res.newState, `seed=${seed} step=${steps}: applyAction returned no state`);
    assert(Array.isArray(res.events), `seed=${seed} step=${steps}: events not an array`);
    state = res.newState;
  }

  assert(plugin.isGameOver(state), `seed=${seed}: game did not finish within ${MAX} steps`);
  assertConserved(state, `seed=${seed} final`);
  return { state, steps, chong: false };
}

function run() {
  const GAMES = 200;
  let twoP = 0, threeP = 0, chong = 0, maxSteps = 0;
  const stepHist = [];

  for (let i = 0; i < GAMES; i++) {
    const seats = i % 3 === 0 ? 3 : 2; // mix 2P and 3P
    let r;
    try {
      r = playOneGame(1000 + i, seats);
    } catch (e) {
      console.error(`\n❌ FAILED at game #${i} (seed=${1000 + i}, seats=${seats})`);
      throw e;
    }
    const { state, steps } = r;
    if (r.chong) chong++;
    if (seats === 2) twoP++; else threeP++;
    maxSteps = Math.max(maxSteps, steps);
    stepHist.push(steps);

    // zero-sum
    const result = plugin.getResult(state);
    assert(result, `seed=${1000 + i}: no result on finished game`);
    const sum = Object.values(result.scores || {}).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 0, `seed=${1000 + i}: scores not zero-sum (sum=${sum}) :: ${JSON.stringify(result.scores)}`);

    // winner consistency
    if (state.winnerSeat != null) {
      const winId = state.players[state.winnerSeat].id;
      assert.strictEqual(result.winnerId, winId, `seed=${1000 + i}: winnerId mismatch`);
    }
  }

  const avg = (stepHist.reduce((a, b) => a + b, 0) / stepHist.length).toFixed(1);
  console.log(`✅ gostop full-game E2E: ${GAMES} games (2P=${twoP}, 3P=${threeP}), ${chong} 총통, avg ${avg} steps, max ${maxSteps}`);
  console.log('   invariants held: turn-guard · illegal-move · hand-privacy · card-conservation · phase-routing · termination · zero-sum');
}

run();
