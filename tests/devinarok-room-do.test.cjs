const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));
const { Miniflare } = require(path.join(__dirname, '../node_modules/miniflare'));

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'realtime-poc/src/index.ts');
const versionSource = fs.readFileSync(
  path.join(ROOT, 'realtime-poc/src/devinarok/js/net/sim-version.js'),
  'utf8',
);
const SIM_HASH = versionSource.match(/SIM_HASH = '([0-9a-f]+)'/)?.[1];

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

function wsClient(socket) {
  socket.accept();
  const queue = [];
  const waiters = [];
  let resolveClose;
  const closeEvent = new Promise((resolve) => { resolveClose = resolve; });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { message = { raw: event.data }; }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else queue.push(message);
  });
  socket.addEventListener('close', (event) => resolveClose(event));
  return {
    socket,
    send(message) { socket.send(JSON.stringify(message)); },
    waitFor(predicate, label = 'message', timeoutMs = 5000) {
      const queuedIndex = queue.findIndex(predicate);
      if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(queue.map((m) => m.t))}`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    close() { try { socket.close(); } catch {} },
    waitForClose(timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket close')), timeoutMs);
        closeEvent.then((event) => {
          clearTimeout(timer);
          resolve(event);
        }, reject);
      });
    },
  };
}

async function connect(mf, roomCode, name, token, simHash = SIM_HASH) {
  const response = await mf.dispatchFetch(`http://localhost/devinarok/${roomCode}`, {
    headers: { Upgrade: 'websocket' },
  });
  assert.equal(response.status, 101, `Expected upgrade, got ${response.status}`);
  assert(response.webSocket);
  const client = wsClient(response.webSocket);
  client.send({
    t: 'hello',
    v: 1,
    simHash,
    name,
    character: { level: 1, equipment: [], potions: 2, clearedStages: [] },
    ...(token ? { token } : {}),
  });
  return client;
}

async function run() {
  assert(SIM_HASH, 'vendored SIM_HASH must be present');
  const mf = new Miniflare({
    modules: true,
    script: bundleWorker(),
    compatibilityDate: '2025-01-01',
    durableObjects: {
      ROOM: { className: 'RoomDO', useSQLite: true },
      COORD: { className: 'CoordinatorDO', useSQLite: true },
      DEVINAROK_ROOM: { className: 'DevinarokRoomDO', useSQLite: true },
    },
  });
  const clients = [];
  try {
    await mf.ready;
    const invalid = await connect(mf, 'BAD234', 'WrongVersion', null, 'not-the-current-hash');
    clients.push(invalid);
    const versionError = await invalid.waitFor((message) => message.t === 'error', 'version error');
    assert.equal(versionError.code, 'version');

    const p0 = await connect(mf, 'ABC234', 'Host');
    clients.push(p0);
    const welcome0 = await p0.waitFor((message) => message.t === 'welcome', 'host welcome');
    const lobby0 = await p0.waitFor((message) => message.t === 'lobby', 'host lobby');
    assert.equal(welcome0.roomCode, 'ABC234');
    assert.equal(welcome0.hostId, welcome0.playerId);
    assert.equal(lobby0.players.length, 1);

    const p1 = await connect(mf, 'ABC234', 'Member');
    clients.push(p1);
    const welcome1 = await p1.waitFor((message) => message.t === 'welcome', 'member welcome');
    const lobby1 = await p1.waitFor((message) => message.t === 'lobby', 'member lobby');
    assert.equal(lobby1.players.length, 2);
    assert.equal(welcome1.hostId, welcome0.playerId);

    p0.send({ t: 'lobby.stage', stageId: 'C2' });
    assert.equal((await p0.waitFor((message) => message.t === 'error', 'locked stage error')).code, 'stage-locked');
    p0.send({ t: 'lobby.stage', stageId: 'C1' });
    p0.send({ t: 'lobby.ready', ready: true });
    p1.send({ t: 'lobby.ready', ready: true });
    await p0.waitFor((message) => message.t === 'lobby' && message.players.every((player) => player.ready), 'all-ready lobby');
    p0.send({ t: 'lobby.start' });
    const start0 = await p0.waitFor((message) => message.t === 'start', 'host start');
    const start1 = await p1.waitFor((message) => message.t === 'start', 'member start');
    const snap0 = await p0.waitFor((message) => message.t === 'snap' && message.full, 'host full snapshot');
    const snap1 = await p1.waitFor((message) => message.t === 'snap' && message.full, 'member full snapshot');
    assert.equal(start0.runId, start1.runId);
    assert.equal(start0.stageId, 'C1');
    assert.equal(start0.party.length, 2);
    assert.equal(snap0.tick, 0);
    assert.equal(snap1.ack, 0);
    assert(Array.isArray(snap0.activeEnemyIds));
    assert(snap0.ents.length >= 5);
    assert(Array.isArray(snap0.ents[0]), 'snapshot entities use compact protocol arrays');

    p0.send({ t: 'ping', c: 122 });
    const lobbyPong = await p0.waitFor((message) => message.t === 'pong' && message.c === 122, 'lobby clock pong');
    assert.equal(lobbyPong.tick, 0);

    p0.send({ t: 'ping', c: 123 });
    const pong = await p0.waitFor((message) => message.t === 'pong', 'clock pong');
    assert.equal(pong.c, 123);
    assert.equal(pong.tick, snap0.tick);

    p0.send({ t: 'in', ae: 0, sa: snap0.tick, inputs: [{ seq: 1, mx: 127, mz: 0, aim: 64, b: 0, vt: 0 }] });
    const applied = await p0.waitFor((message) => message.t === 'snap' && message.ack >= 1, 'input acknowledgement');
    assert(applied.tick >= 2);
    assert.equal(applied.full, false);
    assert.equal(applied.baseTick, snap0.tick);
    for (const key of ['roomIndex', 'roomCleared', 'doorCountdown', 'openDoors', 'activeEnemyIds']) {
      assert.equal(Object.hasOwn(applied, key), false, `${key} is omitted while unchanged`);
    }
    p0.send({
      t: 'in',
      ae: 0,
      sa: applied.tick,
      inputs: Array.from({ length: 5 }, (_, index) => ({
        seq: index + 2,
        mx: 0,
        mz: 0,
        aim: 64,
        b: 0,
        vt: applied.tick,
      })),
    });
    const caughtUp = await p0.waitFor(
      (message) => message.t === 'snap' && message.tick > applied.tick && message.ack >= 5,
      'two-input catch-up',
    );
    assert(caughtUp.tick <= applied.tick + 2, 'backlog catch-up consumes two inputs per world tick');
    p0.send({
      t: 'in',
      ae: 0,
      sa: caughtUp.tick,
      inputs: Array.from({ length: 91 }, (_, index) => ({
        seq: index + 7,
        mx: 0,
        mz: 0,
        aim: 64,
        b: 0,
        vt: applied.tick,
      })),
    });
    const resync = await p0.waitFor(
      (message) => message.t === 'snap' && message.full && message.tick > applied.tick && message.ack >= 4,
      'input-cap full resync',
    );
    assert(resync.ack >= 7);

    const token = welcome1.token;
    const p1Closed = p1.waitForClose();
    p1.close();
    await p1Closed;
    await p0.waitFor((message) => (
      message.t === 'lobby' && message.players.find((player) => player.playerId === welcome1.playerId)?.connected === false
    ), 'disconnect roster');
    const p1b = await connect(mf, 'ABC234', 'Member', token);
    clients.push(p1b);
    const resumed = await p1b.waitFor((message) => message.t === 'welcome', 'resumed welcome');
    const resumedFull = await p1b.waitFor((message) => message.t === 'snap' && message.full, 'resumed full snapshot');
    assert.equal(resumed.playerId, welcome1.playerId);
    assert.equal(resumed.token, token);
    assert(resumedFull.tick >= applied.tick);

    p0.send({ t: 'leave' });
    p1b.send({ t: 'leave' });
    await p1b.waitFor((message) => message.t === 'result', 'member result');

    const p2 = await connect(mf, 'CDE234', 'First');
    clients.push(p2);
    const welcome2 = await p2.waitFor((message) => message.t === 'welcome', 'first joiner welcome');
    const p3 = await connect(mf, 'CDE234', 'Second');
    clients.push(p3);
    const welcome3 = await p3.waitFor((message) => message.t === 'welcome', 'second joiner welcome');
    assert.equal(welcome2.hostId, welcome2.playerId);
    p2.send({ t: 'leave' });
    const transferred = await p3.waitFor((message) => message.t === 'lobby' && message.hostId === welcome3.playerId, 'host transfer');
    assert.equal(transferred.players.length, 1);
    console.log('✓ version gate, lobby, start, compact snapshots, ping, input ack, cap resync, reconnect, and result');
  } finally {
    for (const client of clients) client.close();
    await mf.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
