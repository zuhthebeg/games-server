const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = __dirname;
const presence = fs.readFileSync(path.join(dir, '../../../lib/presence.ts'), 'utf8');
const endpoint = fs.readFileSync(path.join(dir, 'presence.ts'), 'utf8');
const events = fs.readFileSync(path.join(dir, 'events.ts'), 'utf8');
const stream = fs.readFileSync(path.join(dir, 'stream.ts'), 'utf8');
const create = fs.readFileSync(path.join(dir, '../index.ts'), 'utf8');
const join = fs.readFileSync(path.join(dir, 'join.ts'), 'utf8');
const schema = fs.readFileSync(path.join(dir, '../../../../schema.sql'), 'utf8');

assert(schema.includes('last_seen_at TEXT'), 'room_players schema should track last_seen_at');
assert(schema.includes('disconnected_at TEXT'), 'room_players schema should track disconnected_at');

assert(presence.includes('PRESENCE_STALE_MS'), 'presence lib should define stale threshold');
assert(presence.includes("addEvent(env, roomId, 'player_left'"), 'presence lib should emit player_left for stale players');
assert(presence.includes('aiReplacement: true'), 'stale players should request AI replacement');
assert(presence.includes('disconnected_at IS NULL'), 'presence should not repeatedly emit disconnect events');
assert(presence.includes("addEvent(env, roomId, 'player_joined'"), 'presence touch should emit rejoin event after disconnect');
assert(presence.includes('rejoined: true'), 'presence touch should mark rejoin events');

assert(endpoint.includes('touchPlayerPresence'), 'presence endpoint should update current player presence');
assert(events.includes('markStalePlayers'), 'events polling should detect stale players');
assert(stream.includes('markStalePlayers'), 'SSE polling should detect stale players');
assert(create.includes('last_seen_at') && create.includes('disconnected_at'), 'room creation should initialize presence fields');
assert(join.includes('last_seen_at') && join.includes('disconnected_at'), 'join/rejoin should initialize or clear presence fields');

console.log('PASS room presence disconnect/rejoin flow');
