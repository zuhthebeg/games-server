/**
 * Texas Hold'em Poker Plugin
 * 2-8인 텍사스 홀덤
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

// ===== Types =====
interface Card {
    suit: string;  // ♠ ♥ ♦ ♣
    rank: string;  // 2-10, J, Q, K, A
}

interface PokerPlayer {
    id: string;
    nickname: string;
    seat: number;
    chips: number;
    hand: Card[];
    bet: number;
    totalBet: number;  // 이번 핸드 총 베팅
    folded: boolean;
    isAllIn: boolean;
    hasActed: boolean;
}

interface PokerState {
    players: PokerPlayer[];
    deck: Card[];
    communityCards: Card[];
    pot: number;
    sidePots: Array<{ amount: number; eligible: string[] }>;
    phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
    dealerSeat: number;
    currentTurn: number;  // seat index
    currentBet: number;
    minRaise: number;
    lastRaiser: string | null;
    bigBlind: number;
    smallBlind: number;
    roundStarted: boolean;
}

// ===== Constants =====
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// ===== Deck Functions =====
function createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ===== Hand Evaluation =====
function getRankValue(rank: string): number {
    return RANKS.indexOf(rank);
}

function evaluateHand(cards: Card[]): { rank: number; value: number; kickers: number[] } {
    if (cards.length < 5) return { rank: 0, value: 0, kickers: [] };

    const combos = getCombinations(cards, 5);
    let best = { rank: 0, value: 0, kickers: [] as number[] };

    for (const combo of combos) {
        const result = evaluateFiveCards(combo);
        if (compareHands(result, best) > 0) {
            best = result;
        }
    }
    return best;
}

function getCombinations<T>(arr: T[], size: number): T[][] {
    if (size === 1) return arr.map(x => [x]);
    const result: T[][] = [];
    for (let i = 0; i <= arr.length - size; i++) {
        const head = arr[i];
        const tailCombos = getCombinations(arr.slice(i + 1), size - 1);
        for (const tail of tailCombos) {
            result.push([head, ...tail]);
        }
    }
    return result;
}

function evaluateFiveCards(cards: Card[]): { rank: number; value: number; kickers: number[] } {
    const ranks = cards.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = checkStraight(ranks);
    const isWheel = ranks.join(',') === '12,3,2,1,0'; // A-2-3-4-5

    const rankCounts: Record<number, number> = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const countedRanks = Object.entries(rankCounts)
        .sort((a, b) => b[1] - a[1] || parseInt(b[0]) - parseInt(a[0]))
        .map(e => parseInt(e[0]));

    // Royal Flush
    if (isFlush && isStraight && ranks[0] === 12) {
        return { rank: 9, value: 12, kickers: [] };
    }
    // Straight Flush
    if (isFlush && (isStraight || isWheel)) {
        return { rank: 8, value: isWheel ? 3 : ranks[0], kickers: [] };
    }
    // Four of a Kind
    if (counts[0] === 4) {
        return { rank: 7, value: countedRanks[0], kickers: [countedRanks[1]] };
    }
    // Full House
    if (counts[0] === 3 && counts[1] === 2) {
        return { rank: 6, value: countedRanks[0], kickers: [countedRanks[1]] };
    }
    // Flush
    if (isFlush) {
        return { rank: 5, value: ranks[0], kickers: ranks.slice(1) };
    }
    // Straight
    if (isStraight || isWheel) {
        return { rank: 4, value: isWheel ? 3 : ranks[0], kickers: [] };
    }
    // Three of a Kind
    if (counts[0] === 3) {
        return { rank: 3, value: countedRanks[0], kickers: countedRanks.slice(1) };
    }
    // Two Pair
    if (counts[0] === 2 && counts[1] === 2) {
        return { rank: 2, value: Math.max(countedRanks[0], countedRanks[1]),
            kickers: [Math.min(countedRanks[0], countedRanks[1]), countedRanks[2]] };
    }
    // One Pair
    if (counts[0] === 2) {
        return { rank: 1, value: countedRanks[0], kickers: countedRanks.slice(1) };
    }
    // High Card
    return { rank: 0, value: ranks[0], kickers: ranks.slice(1) };
}

function checkStraight(ranks: number[]): boolean {
    const unique = [...new Set(ranks)].sort((a, b) => b - a);
    if (unique.length < 5) return false;
    for (let i = 0; i < 4; i++) {
        if (unique[i] - unique[i + 1] !== 1) return false;
    }
    return true;
}

function compareHands(a: { rank: number; value: number; kickers: number[] },
                      b: { rank: number; value: number; kickers: number[] }): number {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.value !== b.value) return a.value - b.value;
    for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
        const ak = a.kickers[i] || 0;
        const bk = b.kickers[i] || 0;
        if (ak !== bk) return ak - bk;
    }
    return 0;
}

const HAND_NAMES = [
    '하이카드', '원페어', '투페어', '트리플',
    '스트레이트', '플러시', '풀하우스', '포카드',
    '스트레이트 플러시', '로얄 플러시'
];

// ===== Game Logic Helpers =====
function getActivePlayers(state: PokerState): PokerPlayer[] {
    return state.players.filter(p => !p.folded && p.chips > 0 || p.isAllIn);
}

function getNextActivePlayer(state: PokerState, fromSeat: number): number {
    const players = state.players;
    let seat = (fromSeat + 1) % players.length;
    let count = 0;
    while (count < players.length) {
        const p = players[seat];
        if (!p.folded && !p.isAllIn) return seat;
        seat = (seat + 1) % players.length;
        count++;
    }
    return -1;
}

function isRoundComplete(state: PokerState): boolean {
    const active = state.players.filter(p => !p.folded && !p.isAllIn);
    if (active.length <= 1) return true;
    
    // All active players have acted and bets are equal
    const allActed = active.every(p => p.hasActed);
    const betsEqual = active.every(p => p.bet === state.currentBet);
    return allActed && betsEqual;
}

function collectBets(state: PokerState): void {
    for (const p of state.players) {
        state.pot += p.bet;
        p.totalBet += p.bet;
        p.bet = 0;
        p.hasActed = false;
    }
    state.currentBet = 0;
    state.lastRaiser = null;
}

function dealCommunityCards(state: PokerState, count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
        const card = state.deck.pop();
        if (card) {
            cards.push(card);
            state.communityCards.push(card);
        }
    }
    return cards;
}

function determineWinners(state: PokerState): Array<{ playerId: string; amount: number; hand: string }> {
    const activePlayers = state.players.filter(p => !p.folded);
    
    if (activePlayers.length === 1) {
        return [{ playerId: activePlayers[0].id, amount: state.pot, hand: '' }];
    }

    // Evaluate hands
    const evaluations = activePlayers.map(p => ({
        player: p,
        hand: evaluateHand([...p.hand, ...state.communityCards])
    }));

    // Sort by hand strength
    evaluations.sort((a, b) => compareHands(b.hand, a.hand));

    // Find winners (could be ties)
    const bestHand = evaluations[0].hand;
    const winners = evaluations.filter(e => compareHands(e.hand, bestHand) === 0);

    const share = Math.floor(state.pot / winners.length);
    return winners.map(w => ({
        playerId: w.player.id,
        amount: share,
        hand: HAND_NAMES[w.hand.rank]
    }));
}

// ===== Plugin =====
export const pokerPlugin: GamePlugin = {
    id: 'poker',
    name: '텍사스 홀덤',
    minPlayers: 2,
    maxPlayers: 8,

    createInitialState(players: Player[], config?: any): PokerState {
        const startingChips = config?.startingChips || 1000;
        const bigBlind = config?.bigBlind || 20;
        const smallBlind = config?.smallBlind || bigBlind / 2;

        const deck = createDeck();
        const pokerPlayers: PokerPlayer[] = players.map(p => ({
            id: p.id,
            nickname: p.nickname,
            seat: p.seat,
            chips: startingChips,
            hand: [deck.pop()!, deck.pop()!],
            bet: 0,
            totalBet: 0,
            folded: false,
            isAllIn: false,
            hasActed: false,
        }));

        const dealerSeat = 0;
        const sbSeat = players.length === 2 ? dealerSeat : (dealerSeat + 1) % players.length;
        const bbSeat = (sbSeat + 1) % players.length;

        // Post blinds
        const sbPlayer = pokerPlayers[sbSeat];
        const bbPlayer = pokerPlayers[bbSeat];
        
        const sbAmount = Math.min(smallBlind, sbPlayer.chips);
        sbPlayer.chips -= sbAmount;
        sbPlayer.bet = sbAmount;

        const bbAmount = Math.min(bigBlind, bbPlayer.chips);
        bbPlayer.chips -= bbAmount;
        bbPlayer.bet = bbAmount;

        // First to act is after BB (or SB in heads-up)
        const firstToAct = players.length === 2 ? dealerSeat : (bbSeat + 1) % players.length;

        return {
            players: pokerPlayers,
            deck,
            communityCards: [],
            pot: 0,
            sidePots: [],
            phase: 'preflop',
            dealerSeat,
            currentTurn: firstToAct,
            currentBet: bigBlind,
            minRaise: bigBlind,
            lastRaiser: bbPlayer.id,
            bigBlind,
            smallBlind,
            roundStarted: true,
        };
    },

    validateAction(state: PokerState, action: GameAction, playerId: string): ValidationResult {
        const player = state.players.find(p => p.id === playerId);
        if (!player) return { valid: false, error: '플레이어를 찾을 수 없습니다' };
        
        if (state.phase === 'showdown' || state.phase === 'finished') {
            return { valid: false, error: '게임이 종료되었습니다' };
        }

        const currentPlayer = state.players[state.currentTurn];
        if (currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 턴이 아닙니다' };
        }

        if (player.folded) {
            return { valid: false, error: '이미 폴드했습니다' };
        }

        const toCall = state.currentBet - player.bet;

        switch (action.type) {
            case 'fold':
                return { valid: true };
                
            case 'check':
                if (toCall > 0) {
                    return { valid: false, error: '체크할 수 없습니다. 콜 또는 폴드하세요' };
                }
                return { valid: true };
                
            case 'call':
                if (toCall <= 0) {
                    return { valid: false, error: '콜할 금액이 없습니다' };
                }
                return { valid: true };
                
            case 'raise':
                const raiseAmount = action.payload?.amount;
                if (typeof raiseAmount !== 'number') {
                    return { valid: false, error: '레이즈 금액을 지정하세요' };
                }
                const totalBet = raiseAmount;
                const raiseSize = totalBet - state.currentBet;
                if (raiseSize < state.minRaise && totalBet < player.chips + player.bet) {
                    return { valid: false, error: `최소 ${state.minRaise} 이상 레이즈해야 합니다` };
                }
                if (totalBet > player.chips + player.bet) {
                    return { valid: false, error: '칩이 부족합니다' };
                }
                return { valid: true };
                
            case 'allin':
                if (player.chips <= 0) {
                    return { valid: false, error: '칩이 없습니다' };
                }
                return { valid: true };
                
            default:
                return { valid: false, error: '알 수 없는 액션입니다' };
        }
    },

    applyAction(state: PokerState, action: GameAction, playerId: string): ActionResult {
        const newState = JSON.parse(JSON.stringify(state)) as PokerState;
        const player = newState.players.find(p => p.id === playerId)!;
        const events: GameEvent[] = [];
        
        const toCall = newState.currentBet - player.bet;

        switch (action.type) {
            case 'fold':
                player.folded = true;
                events.push({ type: 'fold', playerId, payload: {} });
                break;

            case 'check':
                player.hasActed = true;
                events.push({ type: 'check', playerId, payload: {} });
                break;

            case 'call':
                const callAmount = Math.min(toCall, player.chips);
                player.chips -= callAmount;
                player.bet += callAmount;
                player.hasActed = true;
                if (player.chips === 0) player.isAllIn = true;
                events.push({ type: 'call', playerId, payload: { amount: callAmount } });
                break;

            case 'raise':
                const raiseTotal = action.payload?.amount as number;
                const raiseAmount = raiseTotal - player.bet;
                const actualRaise = Math.min(raiseAmount, player.chips);
                player.chips -= actualRaise;
                player.bet += actualRaise;
                player.hasActed = true;
                if (player.chips === 0) player.isAllIn = true;
                
                newState.minRaise = player.bet - newState.currentBet;
                newState.currentBet = player.bet;
                newState.lastRaiser = playerId;
                
                // Reset hasActed for other players
                newState.players.forEach(p => {
                    if (p.id !== playerId && !p.folded && !p.isAllIn) {
                        p.hasActed = false;
                    }
                });
                
                events.push({ type: 'raise', playerId, payload: { amount: player.bet, raiseBy: actualRaise } });
                break;

            case 'allin':
                const allinAmount = player.chips;
                player.bet += allinAmount;
                player.chips = 0;
                player.isAllIn = true;
                player.hasActed = true;
                
                if (player.bet > newState.currentBet) {
                    newState.minRaise = player.bet - newState.currentBet;
                    newState.currentBet = player.bet;
                    newState.lastRaiser = playerId;
                    newState.players.forEach(p => {
                        if (p.id !== playerId && !p.folded && !p.isAllIn) {
                            p.hasActed = false;
                        }
                    });
                }
                
                events.push({ type: 'allin', playerId, payload: { amount: player.bet } });
                break;
        }

        // Check if only one player left
        const notFolded = newState.players.filter(p => !p.folded);
        if (notFolded.length === 1) {
            collectBets(newState);
            newState.phase = 'finished';
            const winner = notFolded[0];
            winner.chips += newState.pot;
            events.push({ type: 'win', playerId: winner.id, payload: { amount: newState.pot, reason: 'fold' } });
            return { newState, events };
        }

        // Check if round is complete
        if (isRoundComplete(newState)) {
            collectBets(newState);
            
            // Advance phase
            const phases: PokerState['phase'][] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
            const currentIdx = phases.indexOf(newState.phase);
            
            // Check if all but one are all-in
            const canAct = newState.players.filter(p => !p.folded && !p.isAllIn);
            if (canAct.length <= 1) {
                // Run out remaining cards
                while (newState.communityCards.length < 5) {
                    dealCommunityCards(newState, 1);
                }
                newState.phase = 'showdown';
            } else if (newState.phase === 'preflop') {
                dealCommunityCards(newState, 3);
                newState.phase = 'flop';
                events.push({ type: 'flop', payload: { cards: newState.communityCards.slice(0, 3) } });
            } else if (newState.phase === 'flop') {
                dealCommunityCards(newState, 1);
                newState.phase = 'turn';
                events.push({ type: 'turn', payload: { card: newState.communityCards[3] } });
            } else if (newState.phase === 'turn') {
                dealCommunityCards(newState, 1);
                newState.phase = 'river';
                events.push({ type: 'river', payload: { card: newState.communityCards[4] } });
            } else if (newState.phase === 'river') {
                newState.phase = 'showdown';
            }

            // Reset for new betting round
            if (newState.phase !== 'showdown' && newState.phase !== 'finished') {
                newState.currentBet = 0;
                newState.minRaise = newState.bigBlind;
                newState.lastRaiser = null;
                // First to act is after dealer
                newState.currentTurn = getNextActivePlayer(newState, newState.dealerSeat);
            }

            // Handle showdown
            if (newState.phase === 'showdown') {
                const winners = determineWinners(newState);
                for (const w of winners) {
                    const winner = newState.players.find(p => p.id === w.playerId)!;
                    winner.chips += w.amount;
                    events.push({ type: 'win', playerId: w.playerId, payload: { amount: w.amount, hand: w.hand } });
                }
                newState.pot = 0;
                newState.phase = 'finished';
            }
        } else {
            // Next player
            newState.currentTurn = getNextActivePlayer(newState, newState.currentTurn);
        }

        return { newState, events };
    },

    getCurrentTurn(state: PokerState): string | null {
        if (state.phase === 'finished' || state.phase === 'showdown') return null;
        return state.players[state.currentTurn]?.id || null;
    },

    isGameOver(state: PokerState): boolean {
        return state.phase === 'finished';
    },

    getResult(state: PokerState): GameResult | null {
        if (state.phase !== 'finished') return null;

        const withChips = state.players.filter(p => p.chips > 0);
        const scores = Object.fromEntries(state.players.map(p => [p.id, p.chips]));

        if (withChips.length === 1) {
            return { winnerId: withChips[0].id, scores, reason: '모든 칩 획득!' };
        }

        return { scores, reason: '핸드 종료' };
    },

    getPublicState(state: PokerState): any {
        return {
            phase: state.phase,
            pot: state.pot,
            communityCards: state.communityCards,
            currentBet: state.currentBet,
            currentTurn: state.currentTurn,
            dealerSeat: state.dealerSeat,
            bigBlind: state.bigBlind,
            players: state.players.map(p => ({
                id: p.id,
                nickname: p.nickname,
                seat: p.seat,
                chips: p.chips,
                bet: p.bet,
                folded: p.folded,
                isAllIn: p.isAllIn,
                // hand는 숨김
            })),
        };
    },

    getPlayerView(state: PokerState, playerId: string): any {
        const publicState = this.getPublicState(state);
        const player = state.players.find(p => p.id === playerId);
        
        // Show all hands in showdown
        let hands: Record<string, Card[]> = {};
        if (state.phase === 'showdown' || state.phase === 'finished') {
            hands = Object.fromEntries(
                state.players.filter(p => !p.folded).map(p => [p.id, p.hand])
            );
        }
        
        return {
            ...publicState,
            myHand: player?.hand || [],
            showdownHands: hands,
            isMyTurn: state.players[state.currentTurn]?.id === playerId,
            toCall: player ? state.currentBet - player.bet : 0,
        };
    },
};
