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

function testNewPlayerStaticFieldsInDelta() {
  const bundled = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'realtime-poc/src/devinarok-room-do.ts')],
    bundle: true,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const compiled = { exports: {} };
  new Function('module', 'exports', 'require', bundled)(compiled, compiled.exports, require);
  const room = new compiled.exports.DevinarokRoomDO({ storage: {} }, {});
  const look = { family: 'crossbow', characterKind: 'rogue', weapon: '2H_Crossbow', offhand: null, helmet: false, cape: true, weaponRarity: 'rare' };
  const player = {
    id: 42,
    kind: 'player',
    playerId: 'new-player',
    characterKind: 'rogue',
    family: 'crossbow',
    look,
  };
  const firstDelta = room.renderEntity(player, 'viewer', false);
  assert.equal(firstDelta.characterKind, 'rogue');
  assert.equal(firstDelta.family, 'crossbow');
  assert.deepEqual(firstDelta.look, look);
  assert.equal(room.renderEntity(player, 'viewer', false).look, undefined);
  const localSnapshot = room.renderEntity({
    ...player,
    counterReadyTicks: 42,
    counterAttackerId: 7,
    perfectPaid: true,
    dodgeStartTick: 18,
  }, 'new-player', false);
  assert.deepEqual([
    localSnapshot.counterReadyTicks,
    localSnapshot.counterAttackerId,
    localSnapshot.perfectPaid,
    localSnapshot.dodgeStartTick,
  ], [42, 7, true, 18]);
  assert.deepEqual([
    localSnapshot.motion.counterReadyTicks,
    localSnapshot.motion.counterAttackerId,
    localSnapshot.motion.perfectPaid,
    localSnapshot.motion.dodgeStartTick,
  ], [42, 7, true, 18]);
  assert.equal(room.renderEntity({ id: 43, kind: 'enemy', boss: true, attackPattern: 'bone-spear' }, 'viewer', true).attackPattern, 'bone-spear');
}

async function testInputPlayoutBuffer() {
  const bundled = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'realtime-poc/src/devinarok-room-do.ts')],
    bundle: true,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const compiled = { exports: {} };
  new Function('module', 'exports', 'require', bundled)(compiled, compiled.exports, require);
  const {
    DevinarokRoomDO,
    consumeInputsForTick,
    fixedSeedFromRequest,
    inputTargetDepth,
    recordInputBundle,
  } = compiled.exports;
  const seedUrl = new URL('https://example.test/devinarok/ABC234?debug=1&seed=7355608');
  assert.equal(fixedSeedFromRequest(seedUrl, { DEVINAROK_ALLOW_TEST_SEED: '1' }), 7355608);
  assert.equal(fixedSeedFromRequest(seedUrl, {}), null);
  assert.equal(fixedSeedFromRequest(seedUrl, { DEVINAROK_ALLOW_TEST_SEED: '0' }), null);
  assert.equal(
    fixedSeedFromRequest(new URL('https://example.test/?seed=4294967296'), { DEVINAROK_ALLOW_TEST_SEED: '1' }),
    null,
  );
  const inputRoom = Object.create(DevinarokRoomDO.prototype);
  inputRoom.world = { outcome: null, entities: [] };
  inputRoom.inputs = new Map();
  await inputRoom.handleInput('bundle-player', {
    inputs: Array.from({ length: 150_000 }, (_, index) => ({ seq: index + 1 })),
  });
  const bundleState = inputRoom.inputs.get('bundle-player');
  assert.equal(bundleState.inputsReceived, 90);
  assert.equal(bundleState.pending.size, 90);
  assert.equal(bundleState.pending.has(149_911), true);
  assert.equal(bundleState.pending.has(150_000), true);
  assert.equal(inputTargetDepth([]), 1);
  assert.equal(inputTargetDepth([10, 20]), 2);
  assert.equal(inputTargetDepth([70, 80]), 4);
  assert.equal(inputTargetDepth([120]), 4);

  const jitterState = {
    transitOffsetsMs: [],
    inputBundleCounts: [],
    inputBundleIntervalsMs: [],
    lastInputBundleAt: null,
    jitterSamplesMs: [],
    jitterP95Ms: 0,
    targetDepth: 1,
  };
  for (let bundle = 1; bundle <= 120; bundle += 1) {
    const lastSeq = bundle * 3;
    recordInputBundle(jitterState, 5000 + lastSeq * (1000 / 30), lastSeq, 3);
  }
  assert.equal(jitterState.jitterP95Ms, 0);
  assert.equal(jitterState.targetDepth, 1);
  assert.equal(jitterState.inputBundleCounts.length, 120);
  assert.equal(jitterState.inputBundleCounts.at(-1), 3);
  assert.equal(jitterState.inputBundleIntervalsMs.length, 119);
  assert.ok(Math.abs(jitterState.inputBundleIntervalsMs.at(-1) - 100) < 1e-9);

  const state = {
    lastAppliedSeq: 0,
    pending: new Map([[1, { seq: 1 }]]),
    targetDepth: 3,
    buffering: false,
  };
  assert.deepEqual(consumeInputsForTick(state).map((input) => input.seq), [1]);
  assert.equal(state.buffering, false);

  state.pending.clear();
  assert.deepEqual(consumeInputsForTick(state), []);
  assert.equal(state.buffering, true);
  assert.equal(state.emptyBufferStarvedTicks, 1);
  state.pending.set(2, { seq: 2 });
  state.pending.set(3, { seq: 3 });
  assert.deepEqual(consumeInputsForTick(state), []);
  assert.equal(state.refillWaitStarvedTicks, 1);
  state.pending.set(4, { seq: 4 });
  assert.deepEqual(consumeInputsForTick(state).map((input) => input.seq), [2]);
  assert.equal(state.buffering, false);

  state.lastAppliedSeq = 0;
  state.pending = new Map(Array.from({ length: 7 }, (_, index) => [
    index + 1,
    { seq: index + 1 },
  ]));
  state.targetDepth = 3;
  assert.deepEqual(consumeInputsForTick(state).map((input) => input.seq), [1, 2]);
  assert.equal(state.starvedTicks, 2);
  assert.equal(state.sequenceGapStarvedTicks ?? 0, 0);
  assert.equal(state.inputsConsumed, 4);

  const room = Object.create(DevinarokRoomDO.prototype);
  room.runId = null;
  room.world = null;
  assert.equal(room.activeRunTick(), 0);
  room.runId = 'run';
  room.world = { tick: 37, outcome: null };
  assert.equal(room.activeRunTick(), 37);
  room.world.outcome = { type: 'victory' };
  assert.equal(room.activeRunTick(), 37);
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

async function connect(mf, roomCode, name, token, simHash = SIM_HASH, character = { level: 1, equipment: [], potions: 2, clearedStages: [] }) {
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
    character,
    ...(token ? { token } : {}),
  });
  return client;
}

async function testMixedFamilyStageSnapshot() {
  const mf = new Miniflare({
    modules: true,
    script: bundleWorker(),
    compatibilityDate: '2025-01-01',
    bindings: { DEVINAROK_ALLOW_TEST_SEED: '1' },
    durableObjects: {
      ROOM: { className: 'RoomDO', useSQLite: true },
      COORD: { className: 'CoordinatorDO', useSQLite: true },
      DEVINAROK_ROOM: { className: 'DevinarokRoomDO', useSQLite: true },
    },
  });
  const clients = [];
  try {
    await mf.ready;
    const families = [
      { family: 'sword', characterKind: 'knight', weapon: '1H_Sword', itemId: 'rusted-sword' },
      { family: 'crossbow', characterKind: 'rogue', weapon: '1H_Crossbow', itemId: 'rusted-crossbow' },
      { family: 'staff', characterKind: 'mage', weapon: '1H_Wand', itemId: 'apprentice-wand' },
    ];
    const party = [];
    for (const [index, family] of families.entries()) {
      const client = await connect(
        mf,
        'FAM234',
        `Family${index}`,
        null,
        SIM_HASH,
        { level: 1, equipment: [{ itemId: family.itemId, slot: 'weapon' }], potions: 2, clearedStages: [] },
      );
      clients.push(client);
      party.push({ client, family });
      await client.waitFor((message) => message.t === 'welcome', 'family welcome');
    }
    const host = party[0].client;
    await host.waitFor((message) => message.t === 'lobby' && message.players.length === 3, 'mixed-family lobby');
    for (const { client } of party) client.send({ t: 'lobby.ready', ready: true });
    await host.waitFor((message) => message.t === 'lobby' && message.players.every((player) => player.ready), 'mixed-family ready');
    host.send({ t: 'lobby.start' });
    const snapshots = await Promise.all(party.map(async ({ client }) => {
      await client.waitFor((message) => message.t === 'start', 'mixed-family start');
      return client.waitFor((message) => message.t === 'snap' && message.full, 'mixed-family full snapshot');
    }));
    const fields = [
      'id', 'kind', 'x', 'z', 'facing', 'hp', 'state', 'anim', 'attackPhase', 'attackPattern', 'attackShape',
      'attackRemaining', 'skill', 'dodge', 'downed', 'ownerId', 'model', 'maxHp', 'name', 'item',
      'radius', 'motion', 'characterKind', 'family', 'look', 'slowTicks', 'counterReadyTicks',
      'counterAttackerId', 'perfectPaid', 'dodgeStartTick',
    ];
    const expand = (compact) => {
      const [mask, ...rest] = compact;
      const extras = rest.pop();
      const entity = {};
      let valueIndex = 0;
      fields.forEach((field, index) => {
        if (mask & (1 << index)) entity[field] = rest[valueIndex++];
      });
      return { ...entity, ...extras };
    };
    const players = snapshots[0].ents.map(expand).filter((entity) => entity.kind === 'player');
    assert.equal(players.length, 3);
    for (const expected of families) {
      const player = players.find((entry) => entry.family === expected.family);
      assert(player, `missing ${expected.family} player`);
      assert.equal(player.characterKind, expected.characterKind);
      assert.equal(player.look.family, expected.family);
      assert.equal(player.look.weapon, expected.weapon);
    }
    const ownPlayer = players.find((entry) => entry.family === 'sword');
    assert.equal(ownPlayer.motion.counterReadyTicks, 0);
    assert.equal(ownPlayer.motion.counterAttackerId, null);
    assert.equal(ownPlayer.motion.perfectPaid, false);
    assert.equal(ownPlayer.motion.dodgeStartTick, null);
  } finally {
    for (const client of clients) client.close();
    await mf.dispose();
  }
}

async function testGuestCanJoinHostUnlockedCastleStage() {
  const mf = new Miniflare({
    modules: true,
    script: bundleWorker(),
    compatibilityDate: '2025-01-01',
    bindings: { DEVINAROK_ALLOW_TEST_SEED: '1' },
    durableObjects: {
      ROOM: { className: 'RoomDO', useSQLite: true },
      COORD: { className: 'CoordinatorDO', useSQLite: true },
      DEVINAROK_ROOM: { className: 'DevinarokRoomDO', useSQLite: true },
    },
  });
  const clients = [];
  try {
    await mf.ready;
    const host = await connect(mf, 'FST234', 'CastleHost', null, SIM_HASH, {
      level: 14, equipment: [], potions: 2, clearedStages: ['CB', 'FB', 'K1', 'K2', 'K3', 'KB'],
    });
    clients.push(host);
    await host.waitFor((message) => message.t === 'welcome', 'castle host welcome');
    await host.waitFor((message) => message.t === 'lobby', 'castle host lobby');
    const guest = await connect(mf, 'FST234', 'CastleGuest', null, SIM_HASH, {
      level: 1, equipment: [], potions: 2, clearedStages: [],
    });
    clients.push(guest);
    await guest.waitFor((message) => message.t === 'welcome', 'castle guest welcome');
    await host.waitFor((message) => message.t === 'lobby' && message.players.length === 2, 'castle guest joined');

    host.send({ t: 'lobby.stage', stageId: 'F2' });
    assert.equal((await host.waitFor((message) => message.t === 'error', 'locked forest stage error')).code, 'stage-locked');
    host.send({ t: 'lobby.stage', stageId: 'C1', difficulty: 'nightmare' });
    await host.waitFor((message) => message.t === 'lobby' && message.difficulty === 'nightmare', 'unlocked nightmare tier');
    host.send({ t: 'lobby.stage', stageId: 'C1', difficulty: 'hell' });
    assert.equal((await host.waitFor((message) => message.t === 'error', 'locked hell tier')).code, 'stage-locked');
    host.send({ t: 'lobby.stage', stageId: 'C1', difficulty: 'normal' });
    await host.waitFor((message) => message.t === 'lobby' && message.difficulty === 'normal', 'normal tier restored');
    host.send({ t: 'lobby.stage', stageId: 'F1' });
    await host.waitFor((message) => message.t === 'lobby' && message.stageId === 'F1', 'host selected unlocked forest stage');
    for (const stageId of ['K1', 'K2', 'K3', 'KB']) {
      host.send({ t: 'lobby.stage', stageId });
      await host.waitFor((message) => message.t === 'lobby' && message.stageId === stageId, `host selected unlocked ${stageId}`);
    }
    guest.send({ t: 'lobby.ready', ready: true });
    await host.waitFor(
      (message) => message.t === 'lobby' && message.players.some((player) => player.playerId !== message.hostId && player.ready),
      'guest ready while host remains unready',
    );
    host.send({ t: 'lobby.start' });
    const [hostStart, guestStart] = await Promise.all([
      host.waitFor((message) => message.t === 'start', 'castle host start'),
      guest.waitFor((message) => message.t === 'start', 'castle guest start'),
    ]);
    assert.equal(hostStart.stageId, 'KB');
    assert.equal(guestStart.stageId, 'KB');

    const solo = await connect(mf, 'FST235', 'SoloHost', null, SIM_HASH, {
      level: 1, equipment: [], potions: 2, clearedStages: [],
    });
    clients.push(solo);
    await solo.waitFor((message) => message.t === 'welcome', 'solo host welcome');
    await solo.waitFor((message) => message.t === 'lobby', 'solo host lobby');
    solo.send({ t: 'lobby.start' });
    assert.equal((await solo.waitFor((message) => message.t === 'start', 'solo host start')).stageId, 'C1');
  } finally {
    for (const client of clients) client.close();
    await mf.dispose();
  }
}

async function run() {
  await testInputPlayoutBuffer();
  assert(SIM_HASH, 'vendored SIM_HASH must be present');
  testNewPlayerStaticFieldsInDelta();
  await testMixedFamilyStageSnapshot();
  await testGuestCanJoinHostUnlockedCastleStage();
  const mf = new Miniflare({
    modules: true,
    script: bundleWorker(),
    compatibilityDate: '2025-01-01',
    bindings: { DEVINAROK_ALLOW_TEST_SEED: '1' },
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
    assert.equal(lobby0.public, true);
    assert.equal(lobby0.difficulty, 'normal');
    let listed = await (await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok')).json();
    assert.equal(listed.rooms.length, 1);
    assert.deepEqual(listed.rooms[0].meta, {
      code: 'ABC234',
      hostName: 'Host',
      stageId: 'C1',
      difficulty: 'normal',
      hostLevel: 1,
      public: true,
    });

    p0.send({ t: 'lobby.public', public: false });
    await p0.waitFor((message) => message.t === 'lobby' && message.public === false, 'private lobby');
    listed = await (await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok')).json();
    assert.equal(listed.rooms.length, 0);
    p0.send({ t: 'lobby.public', public: true });
    await p0.waitFor((message) => message.t === 'lobby' && message.public === true, 'public lobby');

    const p1 = await connect(mf, 'ABC234', 'Member');
    clients.push(p1);
    const welcome1 = await p1.waitFor((message) => message.t === 'welcome', 'member welcome');
    const lobby1 = await p1.waitFor((message) => message.t === 'lobby', 'member lobby');
    assert.equal(lobby1.players.length, 2);
    assert.equal(welcome1.hostId, welcome0.playerId);

    p0.send({ t: 'lobby.stage', stageId: 'C2' });
    assert.equal((await p0.waitFor((message) => message.t === 'error', 'locked stage error')).code, 'stage-locked');
    p0.send({ t: 'lobby.stage', stageId: 'C1', difficulty: 'nightmare' });
    assert.equal((await p0.waitFor((message) => message.t === 'error', 'locked nightmare error')).code, 'stage-locked');
    p0.send({ t: 'lobby.stage', stageId: 'C1' });
    p0.send({ t: 'lobby.ready', ready: true });
    p1.send({ t: 'lobby.ready', ready: true });
    await p0.waitFor((message) => message.t === 'lobby' && message.players.every((player) => player.ready), 'all-ready lobby');
    p0.send({ t: 'ping', c: 122 });
    const lobbyPong = await p0.waitFor(
      (message) => message.t === 'pong' && message.c === 122,
      'lobby clock pong',
    );
    assert.equal(lobbyPong.tick, 0, 'lobby ping uses tick zero');
    p0.send({ t: 'lobby.start' });
    const start0 = await p0.waitFor((message) => message.t === 'start', 'host start');
    const start1 = await p1.waitFor((message) => message.t === 'start', 'member start');
    const snap0 = await p0.waitFor((message) => message.t === 'snap' && message.full, 'host full snapshot');
    const snap1 = await p1.waitFor((message) => message.t === 'snap' && message.full, 'member full snapshot');
    assert.equal(start0.runId, start1.runId);
    assert.equal(start0.tick, snap0.tick);
    assert.equal(start0.stageId, 'C1');
    assert.equal(start0.difficulty, 'normal');
    assert.equal(start0.party.length, 2);
    assert.equal(snap0.tick, 0);
    assert.equal(snap0.difficulty, 'normal');
    assert.equal(snap1.ack, 0);
    assert(Array.isArray(snap0.activeEnemyIds));
    assert.equal((await (await mf.dispatchFetch('http://localhost/coord/match?g=devinarok')).json()).roomId, null);
    assert(snap0.ents.length >= 5);
    assert(Array.isArray(snap0.ents[0]), 'snapshot entities use compact protocol arrays');
    const fields = [
      'id', 'kind', 'x', 'z', 'facing', 'hp', 'state', 'anim', 'attackPhase', 'attackPattern',
      'attackShape', 'attackRemaining', 'skill', 'dodge', 'downed', 'ownerId', 'model',
      'maxHp', 'name', 'item', 'radius', 'motion', 'characterKind', 'family', 'look', 'slowTicks',
    ];
    const expandEntity = (compact) => {
      const [mask, ...rest] = compact;
      const extras = rest.pop();
      const entity = {};
      let valueIndex = 0;
      fields.forEach((field, index) => {
        if (mask & (1 << index)) entity[field] = rest[valueIndex++];
      });
      return { ...entity, ...extras };
    };
    const expandedPlayers = snap0.ents.map(expandEntity).filter((entity) => entity.kind === 'player');
    assert.equal(expandedPlayers.length, 2);
    for (const player of expandedPlayers) {
      assert.equal(player.characterKind, 'knight');
      assert.equal(player.family, 'sword');
      assert.deepEqual(player.look, {
        family: 'sword',
        characterKind: 'knight',
        weapon: '1H_Sword',
        offhand: 'Round_Shield',
        helmet: false,
        cape: false,
        weaponRarity: null,
      });
    }

    const pongPromise = p0.waitFor(
      (message) => message.t === 'pong' && message.c === 123,
      'run clock pong',
    );
    const appliedPromise = p0.waitFor(
      (message) => message.t === 'snap' && message.ack >= 1,
      'input acknowledgement',
    );
    p0.send({ t: 'ping', c: 123 });
    p0.send({ t: 'in', ae: 0, sa: snap0.tick, inputs: [{ seq: 1, mx: 127, mz: 0, aim: 64, b: 0, vt: 0 }] });
    const [pong, applied] = await Promise.all([pongPromise, appliedPromise]);
    assert(pong.tick >= snap0.tick);
    assert(pong.tick <= applied.tick && applied.tick - pong.tick <= 4, 'run pong is within four ticks of the latest snapshot');
    assert(applied.tick >= 1);
    assert.equal(applied.full, false);
    assert.equal(applied.baseTick, snap0.tick);
    for (const key of ['roomIndex', 'roomCleared', 'doorCountdown', 'openDoors', 'activeEnemyIds']) {
      assert.equal(Object.hasOwn(applied, key), false, `${key} is omitted while unchanged`);
    }
    p0.send({
      t: 'in',
      ae: 0,
      sa: applied.tick,
      inputs: Array.from({ length: 8 }, (_, index) => ({
        seq: index + 2,
        mx: 0,
        mz: 0,
        aim: 64,
        b: 0,
        vt: applied.tick,
      })),
    });
    const caughtUp = await p0.waitFor(
      (message) => message.t === 'snap' && message.tick > applied.tick && message.ack >= 3,
      'two-input catch-up',
    );
    p0.send({
      t: 'in',
      ae: 0,
      sa: caughtUp.tick,
      inputs: Array.from({ length: 91 }, (_, index) => ({
        seq: index + 10,
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
    for (let attempts = 0; attempts < 20; attempts += 1) {
      listed = await (await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok')).json();
      if (listed.rooms.some((room) => room.roomId === 'devinarok:CDE234' && room.players === 1)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(listed.rooms.some((room) => room.roomId === 'devinarok:CDE234' && room.players === 1));
    const p3Closed = p3.waitForClose();
    p3.close();
    await p3Closed;
    for (let attempts = 0; attempts < 20; attempts += 1) {
      listed = await (await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok')).json();
      if (!listed.rooms.some((room) => room.roomId === 'devinarok:CDE234')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(listed.rooms.some((room) => room.roomId === 'devinarok:CDE234'), false);
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
