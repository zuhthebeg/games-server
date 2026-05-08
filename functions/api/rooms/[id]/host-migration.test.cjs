const fs = require('fs');
const assert = require('assert');

const presence = fs.readFileSync(__dirname + '/../../../lib/presence.ts', 'utf8');
const leave = fs.readFileSync(__dirname + '/leave.ts', 'utf8');

assert(presence.includes('export async function migrateHostIfNeeded'), 'presence lib should expose host migration helper');
assert(presence.includes("r.status = 'playing'"), 'host migration should only run for active games');
assert(presence.includes('AND disconnected_at IS NULL'), 'new host should be an actively connected player');
assert(presence.includes("UPDATE rooms SET host_id = ? WHERE id = ?"), 'host migration should update room host_id');
assert(presence.includes("addEvent(env, roomId, 'host_changed'"), 'host migration should notify clients');
assert(presence.includes('if (player.user_id === player.host_id) staleHostId = player.user_id'), 'presence timeout should detect stale host');
assert(leave.includes('migrateHostIfNeeded'), 'explicit active host leave should also migrate host');
assert(leave.includes('UPDATE room_players SET disconnected_at = ?'), 'active leave should mark player disconnected while preserving seat');

console.log('PASS active host migration');
