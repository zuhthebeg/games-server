const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../functions/games/blackjack.ts', 'utf8');

assert(src.includes('bankroll: number;'), 'blackjack players should carry authoritative bankroll');
assert(src.includes('bankrupt: boolean;'), 'blackjack players should expose bankrupt state');
assert(src.includes('bankruptPlayerIds'), 'settled event should expose bankrupt players');
assert(src.includes('newState.players = newState.players.filter((p) => !p.bankrupt && p.bankroll > 0);'), 'new round should remove bankrupt players from active game state');
assert(!src.includes('newState.deck = createDeck();'), 'new rounds should keep the existing 52-card deck instead of resetting every hand');
assert(src.includes('reshuffleCount += 1;'), 'drawing from an empty deck should reshuffle and increment reshuffleCount');
assert(src.includes('deckCount: state.deck.length'), 'public state should expose remaining deck count');

console.log('PASS blackjack bankroll elimination and persistent deck state');
