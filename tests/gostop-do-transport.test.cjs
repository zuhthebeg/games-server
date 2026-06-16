/**
 * gostop RoomDO transport E2E (real WebSocket via Miniflare/workerd)
 *
 * Exercises the NEW code path of the DO+WS migration end to end:
 *   - 2 clients connect to the same room → presence/connections count
 *   - start → both receive 'started' + their own 'state' view
 *   - hand privacy over the wire: each view shows only its own myHand,
 *     opponents expose handCount only
 *   - turn guard over the wire: off-turn PLAY gets an 'error', no state change
 *   - on-turn PLAY round-trips: server validates, applies, broadcasts new state
 *   - reconnect: a returning socket immediately gets the current 'state'
 *
 * Pure game-rule correctness is covered by gostop-fullgame-e2e.test.cjs;
 * this test is about the transport/DO wiring being correct.
 */
const path = require('path');
const assert = require('assert');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));
const { Miniflare } = require(path.join(__dirname, '../node_modules/miniflare'));

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'realtime-poc/src/index.ts');

function bundleWorker() {
  const out = esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

// --- WS helper: collect messages, await one matching a predicate ---
function wsClient(socket) {
  socket.accept();
  const queue = [];
  const waiters = [];
  socket.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { msg = { type: 'raw', data: e.data }; }
    const idx = waiters.findIndex((w) => w.pred(msg));
    if (idx >= 0) { const w = waiters.splice(idx, 1)[0]; clearTimeout(w.timer); w.resolve(msg); }
    else queue.push(msg);
  });
  return {
    socket,
    send: (obj) => socket.send(JSON.stringify(obj)),
    // wait for next message matching pred (checks already-queued first)
    waitFor(pred, label = 'message', ms = 4000) {
      const qi = queue.findIndex(pred);
      if (qi >= 0) return Promise.resolve(queue.splice(qi, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`timeout waiting for ${label}; queued=${JSON.stringify(queue.map((m) => m.type))}`));
        }, ms);
        waiters.push({ pred, resolve, timer });
      });
    },
    close: () => socket.close(),
  };
}

async function connect(mf, room, user) {
  const res = await mf.dispatchFetch(`http://localhost/room/${room}?u=${user}`, {
    headers: { Upgrade: 'websocket' },
  });
  assert.strictEqual(res.status, 101, `WS upgrade failed for ${user}: status ${res.status}`);
  assert(res.webSocket, `no webSocket on response for ${user}`);
  return wsClient(res.webSocket);
}

async function run() {
  const script = bundleWorker();

  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2025-01-01',
    durableObjects: { ROOM: { className: 'RoomDO', useSQLite: true } },
  });
  await mf.ready;

  let passed = 0;
  try {
    const room = 'e2e-room-1';

    // 1) two clients connect
    const p0 = await connect(mf, room, 'p0');
    const c0 = await p0.waitFor((m) => m.type === 'connected', 'p0 connected');
    assert.strictEqual(c0.started, false, 'fresh room should not be started');

    const p1 = await connect(mf, room, 'p1');
    await p1.waitFor((m) => m.type === 'connected', 'p1 connected');
    // p0 should observe presence join → connections == 2 at some point
    const pres = await p0.waitFor((m) => m.type === 'presence' && m.connections === 2, 'p0 sees 2 connections');
    assert.strictEqual(pres.connections, 2);
    passed++;
    console.log('  ✓ two clients connect, presence count = 2');

    // 2) start → both get 'started' + own 'state'
    p0.send({ type: 'start', config: { seats: 2 } });
    await p0.waitFor((m) => m.type === 'started', 'p0 started');
    await p1.waitFor((m) => m.type === 'started', 'p1 started');
    const v0 = (await p0.waitFor((m) => m.type === 'state', 'p0 state')).view;
    const v1 = (await p1.waitFor((m) => m.type === 'state', 'p1 state')).view;
    assert.strictEqual(v0.myHand.length, 10, `2P deal: p0 should hold 10, got ${v0.myHand.length}`);
    assert.strictEqual(v1.myHand.length, 10, `2P deal: p1 should hold 10, got ${v1.myHand.length}`);
    passed++;
    console.log('  ✓ start deals 10 cards to each over the wire');

    // 3) hand privacy over the wire
    for (const [v, me] of [[v0, 'p0'], [v1, 'p1']]) {
      for (const p of v.players) {
        if (p.id === me) continue;
        assert.strictEqual(p.hand, undefined, `${me}'s view leaked ${p.id}'s hand`);
        assert.strictEqual(p.handCount, 10, `${me}'s view: ${p.id} handCount should be 10`);
      }
    }
    passed++;
    console.log('  ✓ opponent hands hidden over the wire (handCount only)');

    // 4) turn guard: off-turn player's PLAY is rejected
    const onTurn = v0.isMyTurn ? p0 : p1;
    const offTurn = v0.isMyTurn ? p1 : p0;
    const offView = v0.isMyTurn ? v1 : v0;
    offTurn.send({ type: 'action', action: { type: 'PLAY', payload: { cardId: offView.myHand[0].id } } });
    const err = await offTurn.waitFor((m) => m.type === 'error', 'off-turn error');
    assert(/차례/.test(err.error || ''), `expected turn-guard error, got: ${err.error}`);
    passed++;
    console.log(`  ✓ off-turn PLAY rejected over the wire ("${err.error}")`);

    // 5) on-turn PLAY round-trips → new state broadcast to both
    const onView = v0.isMyTurn ? v0 : v1;
    onTurn.send({ type: 'action', action: { type: 'PLAY', payload: { cardId: onView.myHand[0].id } } });
    // both clients should receive a fresh state (or a pending/flip prompt) and NO error
    const ns0 = await p0.waitFor((m) => m.type === 'state', 'p0 post-play state');
    const ns1 = await p1.waitFor((m) => m.type === 'state', 'p1 post-play state');
    assert(ns0.view && ns1.view, 'post-play state views present');
    // the player who played either now has 9 cards, or is in a pending/flip phase
    const playedView = v0.isMyTurn ? ns0.view : ns1.view;
    const progressed =
      playedView.myHand.length === 9 ||
      !!playedView.pending ||
      !!playedView.pendingFlip ||
      playedView.finished;
    assert(progressed, `on-turn PLAY did not progress state: hand=${playedView.myHand.length}`);
    passed++;
    console.log('  ✓ on-turn PLAY round-trips and progresses state');

    // 6b) event stream carries the juice contract the client (mpOnEvent) depends on:
    //     a 'play' event with payload.cardId + stags[] + stolen[] + captured[].
    const playEv = await p0.waitFor((m) => m.type === 'event' && m.event && m.event.type === 'play', 'play event', 4000);
    const pe = playEv.event;
    assert(typeof playEv.seq === 'number', 'event message carries a seq');
    assert(pe.payload && pe.payload.cardId, 'play event has cardId');
    assert(Array.isArray(pe.payload.stags), 'play event has stags[] (voice triggers)');
    assert(Array.isArray(pe.payload.stolen), 'play event has stolen[] (피뺏기)');
    assert(Array.isArray(pe.payload.captured), 'play event has captured[] (take sound)');
    passed++;
    console.log('  ✓ event stream delivers play-juice contract (cardId·stags·stolen·captured)');

    // 7) reconnect restores current state immediately
    p1.close();
    await new Promise((r) => setTimeout(r, 50));
    const p1b = await connect(mf, room, 'p1');
    await p1b.waitFor((m) => m.type === 'connected' && m.started === true, 'reconnect connected(started)');
    const restored = await p1b.waitFor((m) => m.type === 'state', 'reconnect state');
    assert(restored.view && restored.view.mySeat >= 0, 'reconnect should restore p1 view with a seat');
    passed++;
    console.log('  ✓ reconnect restores in-progress state for returning player');

    p0.close(); p1b.close();
  } finally {
    await mf.dispose();
  }

  console.log(`\n✅ gostop DO transport E2E: ${passed}/7 wire checks passed`);
  if (passed !== 7) process.exit(1);
}

run().catch((e) => { console.error('\n❌ DO transport E2E failed:\n', e); process.exit(1); });
