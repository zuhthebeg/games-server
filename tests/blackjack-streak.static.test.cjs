const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../functions/games/blackjack.ts', 'utf8');

assert(src.includes('streak: number;'), 'BlackjackPlayer should carry per-player streak');
assert(src.includes('streak: 0,'), 'new players should start with zero streak');
assert(src.includes('player.streak += 1;'), 'winning settlement should increment player streak');
assert(src.includes('player.streak = 0;'), 'losing settlement should reset player streak');
assert(src.includes('streaks:'), 'settled event should expose streaks for clients');
assert(src.includes('p.hands = [];') && src.includes('p.ready = false;'), 'new round should reset hand state while preserving cumulative fields');

console.log('PASS blackjack server streak state');
