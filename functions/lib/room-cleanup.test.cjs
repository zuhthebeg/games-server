const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/room-cleanup.ts', 'utf8');
const roomsApi = fs.readFileSync(__dirname + '/../api/rooms/index.ts', 'utf8');
const roomGet = fs.readFileSync(__dirname + '/../api/rooms/[id]/index.ts', 'utf8');
const join = fs.readFileSync(__dirname + '/../api/rooms/[id]/join.ts', 'utf8');
const start = fs.readFileSync(__dirname + '/../api/rooms/[id]/start.ts', 'utf8');

assert(src.includes('WAITING_SOLO_MAX_MS = 30 * 60 * 1000'), 'solo waiting rooms should expire after 30 minutes');
assert(src.includes("r.status = 'waiting' AND player_count <= 1"), 'cleanup should target waiting host-only rooms');
assert(src.includes("r.status = 'playing' AND player_count <= 1"), 'cleanup should target old playing solo zombie rooms');
assert(src.includes("r.status = 'finished'"), 'cleanup should purge old finished rooms');
assert(src.includes('DELETE FROM events WHERE room_id IN'), 'cleanup should delete events before rooms');
assert(src.includes('DELETE FROM room_players WHERE room_id IN'), 'cleanup should delete players before rooms');
assert(src.includes('DELETE FROM rooms WHERE id IN'), 'cleanup should delete rooms');

for (const [name, file] of Object.entries({ roomsApi, roomGet, join, start })) {
  assert(file.includes('cleanupStaleRooms'), `${name} should trigger stale room cleanup`);
}
assert(roomsApi.includes('cleaned: cleanup.deleted'), 'list endpoint should expose cleanup count for verification');

console.log('PASS stale room cleanup policy');
