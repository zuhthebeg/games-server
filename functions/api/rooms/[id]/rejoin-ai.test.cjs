const fs = require('fs');
const assert = require('assert');

const join = fs.readFileSync(__dirname + '/join.ts', 'utf8');
const leave = fs.readFileSync(__dirname + '/leave.ts', 'utf8');

assert(join.indexOf('SELECT * FROM room_players WHERE room_id = ? AND user_id = ?') < join.indexOf("if (room.status !== 'waiting')"), 'join should check existing membership before rejecting playing rooms');
assert(join.includes("room.status === 'playing'"), 'join should explicitly allow rejoin for existing players in playing rooms');
assert(join.includes("rejoined: true"), 'join should emit/return a rejoined marker');
assert(leave.includes("if (room.status === 'playing')"), 'leave should preserve player seat during active games');
assert(leave.indexOf("if (room.status === 'playing')") < leave.indexOf('DELETE FROM room_players'), 'active leave should return before deleting player membership');
assert(leave.includes("aiReplacement: true"), 'active leave event should tell clients to use AI replacement');

console.log('PASS room rejoin ai server flow');
