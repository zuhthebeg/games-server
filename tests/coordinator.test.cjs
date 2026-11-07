const assert = require('assert');
const path = require('path');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));
const { Miniflare } = require(path.join(__dirname, '../node_modules/miniflare'));

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'realtime-poc/src/index.ts');

async function run() {
  const bundle = esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const mf = new Miniflare({
    modules: true,
    script: bundle,
    compatibilityDate: '2025-01-01',
    durableObjects: {
      ROOM: { className: 'RoomDO', useSQLite: true },
      COORD: { className: 'CoordinatorDO', useSQLite: true },
      DEVINAROK_ROOM: { className: 'DevinarokRoomDO', useSQLite: true },
    },
  });
  try {
    await mf.ready;
    const report = (body) => mf.dispatchFetch('http://localhost/coord/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const meta = {
      code: 'ABC234',
      hostName: 'Host',
      stageId: 'C1',
      hostLevel: 3,
      public: true,
    };
    assert.equal((await report({
      roomId: 'devinarok:ABC234',
      gameType: 'devinarok',
      players: 2,
      max: 4,
      started: false,
      event: 'create',
      meta,
    })).status, 200);
    const roomsResponse = await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok');
    const rooms = await roomsResponse.json();
    assert.equal(rooms.rooms.length, 1);
    assert.deepEqual(rooms.rooms[0].meta, meta);
    assert.equal(typeof rooms.rooms[0].updatedAt, 'number');

    const matchResponse = await mf.dispatchFetch('http://localhost/coord/match?g=devinarok');
    const match = await matchResponse.json();
    assert.equal(match.roomId, 'devinarok:ABC234');
    assert.deepEqual(match.meta, meta);
    assert.equal(typeof match.updatedAt, 'number');

    await report({
      roomId: 'devinarok:ABC234',
      gameType: 'devinarok',
      players: 2,
      max: 4,
      started: false,
      event: 'empty',
      meta: { ...meta, public: false },
    });
    assert.equal((await (await mf.dispatchFetch('http://localhost/coord/rooms?g=devinarok')).json()).rooms.length, 0);
    assert.equal((await (await mf.dispatchFetch('http://localhost/coord/match?g=devinarok')).json()).roomId, null);

    await report({
      roomId: 'legacy-room',
      gameType: 'gostop',
      players: 1,
      max: 2,
      started: false,
      event: 'create',
    });
    const otherGame = await (await mf.dispatchFetch('http://localhost/coord/rooms?g=gostop')).json();
    assert.equal(otherGame.rooms[0].roomId, 'legacy-room');
    assert.equal(otherGame.rooms[0].meta, null);
    assert.equal(typeof otherGame.rooms[0].updatedAt, 'number');
    console.log('✓ additive room metadata, quick match, private removal, and other-game listing');
  } finally {
    await mf.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
