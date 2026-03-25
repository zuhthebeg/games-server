/**
 * Blackjack Multiplayer Plugin
 * 플레이어는 각자 딜러와 1:1 대결
 */

import type { GamePlugin, Player, GameAction, ValidationResult, ActionResult, GameResult, GameEvent } from './types';

interface Card {
    suit: string;
    rank: string;
}

interface BlackjackHand {
    cards: Card[];
    bet: number;
    stood: boolean;
    busted: boolean;
    blackjack: boolean;
    doubled: boolean;
}

interface BlackjackPlayer {
    id: string;
    nickname: string;
    seat: number;
    hands: BlackjackHand[];
    bet: number;
    totalWinnings: number;
    ready: boolean;
}

interface BlackjackState {
    players: BlackjackPlayer[];
    dealer: { cards: Card[]; revealed: boolean };
    deck: Card[];
    phase: 'betting' | 'dealing' | 'playing' | 'dealer_turn' | 'settling' | 'finished';
    currentPlayerIndex: number;
    currentHandIndex: number;
    config: { minBet: number; maxBet: number };
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return shuffle(deck);
}

function cardValue(rank: string): number {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return parseInt(rank, 10);
}

function getHandValue(cards: Card[]): { total: number; soft: boolean } {
    let total = 0;
    let aces = 0;

    for (const card of cards) {
        total += cardValue(card.rank);
        if (card.rank === 'A') aces++;
    }

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return { total, soft: aces > 0 };
}

function isBlackjack(cards: Card[]): boolean {
    return cards.length === 2 && getHandValue(cards).total === 21;
}

function drawCard(state: BlackjackState): Card {
    if (state.deck.length === 0) {
        state.deck = createDeck();
    }
    const card = state.deck.pop();
    if (!card) {
        throw new Error('덱에서 카드를 뽑을 수 없습니다');
    }
    return card;
}

function isHandDone(hand: BlackjackHand): boolean {
    return hand.stood || hand.busted || hand.blackjack;
}

function findNextPlayableHand(state: BlackjackState, fromPlayer: number, fromHand: number): { playerIndex: number; handIndex: number } | null {
    const totalPlayers = state.players.length;

    for (let pOffset = 0; pOffset < totalPlayers; pOffset++) {
        const playerIndex = (fromPlayer + pOffset) % totalPlayers;
        const player = state.players[playerIndex];
        const startHand = pOffset === 0 ? fromHand : 0;

        for (let h = startHand; h < player.hands.length; h++) {
            if (!isHandDone(player.hands[h])) {
                return { playerIndex, handIndex: h };
            }
        }
    }

    return null;
}

function startDealing(state: BlackjackState, events: GameEvent[]): void {
    state.phase = 'dealing';

    for (const player of state.players) {
        const handCards = [drawCard(state), drawCard(state)];
        player.hands = [{
            cards: handCards,
            bet: player.bet,
            stood: false,
            busted: false,
            blackjack: isBlackjack(handCards),
            doubled: false,
        }];
    }

    state.dealer.cards = [drawCard(state), drawCard(state)];
    state.dealer.revealed = false;

    state.phase = 'playing';
    state.currentPlayerIndex = 0;
    state.currentHandIndex = 0;

    const next = findNextPlayableHand(state, 0, 0);
    if (next) {
        state.currentPlayerIndex = next.playerIndex;
        state.currentHandIndex = next.handIndex;
    } else {
        state.phase = 'dealer_turn';
    }

    events.push({
        type: 'dealing_started',
        payload: {
            playerCount: state.players.length,
            dealerUpCard: state.dealer.cards[0],
        },
    });
}

function advanceTurnOrDealer(state: BlackjackState): void {
    const next = findNextPlayableHand(state, state.currentPlayerIndex, state.currentHandIndex + 1);
    if (next) {
        state.currentPlayerIndex = next.playerIndex;
        state.currentHandIndex = next.handIndex;
        return;
    }

    const nextFromNextPlayer = findNextPlayableHand(state, (state.currentPlayerIndex + 1) % state.players.length, 0);
    if (nextFromNextPlayer) {
        state.currentPlayerIndex = nextFromNextPlayer.playerIndex;
        state.currentHandIndex = nextFromNextPlayer.handIndex;
        return;
    }

    state.phase = 'dealer_turn';
}

function runDealerTurn(state: BlackjackState, events: GameEvent[]): void {
    state.dealer.revealed = true;
    const drawn: Card[] = [];

    while (getHandValue(state.dealer.cards).total < 17) {
        const card = drawCard(state);
        state.dealer.cards.push(card);
        drawn.push(card);
    }

    state.phase = 'settling';
    events.push({
        type: 'dealer_turn_completed',
        payload: {
            dealerTotal: getHandValue(state.dealer.cards).total,
            drawnCount: drawn.length,
        },
    });
}

function settleGame(state: BlackjackState, events: GameEvent[]): void {
    const dealerTotal = getHandValue(state.dealer.cards).total;
    const dealerBust = dealerTotal > 21;
    const dealerBlackjack = isBlackjack(state.dealer.cards);
    const roundResults: Array<{ playerId: string; handIndex: number; result: 'win' | 'lose' | 'push'; payout: number }> = [];

    for (const player of state.players) {
        let net = 0;

        for (let i = 0; i < player.hands.length; i++) {
            const hand = player.hands[i];
            const handTotal = getHandValue(hand.cards).total;
            let payout = 0;
            let result: 'win' | 'lose' | 'push' = 'lose';

            if (hand.busted) {
                payout = -hand.bet;
                result = 'lose';
            } else if (hand.blackjack && !dealerBlackjack) {
                payout = hand.bet * 1.5;
                result = 'win';
            } else if (dealerBust) {
                payout = hand.bet;
                result = 'win';
            } else if (dealerBlackjack && !hand.blackjack) {
                payout = -hand.bet;
                result = 'lose';
            } else if (handTotal > dealerTotal) {
                payout = hand.bet;
                result = 'win';
            } else if (handTotal < dealerTotal) {
                payout = -hand.bet;
                result = 'lose';
            } else {
                payout = 0;
                result = 'push';
            }

            net += payout;
            roundResults.push({
                playerId: player.id,
                handIndex: i,
                result,
                payout,
            });
        }

        player.totalWinnings += net;
    }

    state.phase = 'finished';
    events.push({
        type: 'settled',
        payload: {
            dealerTotal,
            dealerBust,
            dealerBlackjack,
            results: roundResults,
        },
    });
}

function runPostActionPhases(state: BlackjackState, events: GameEvent[]): void {
    if (state.phase === 'dealer_turn') {
        runDealerTurn(state, events);
    }

    if (state.phase === 'settling') {
        settleGame(state, events);
    }
}

function cloneState(state: BlackjackState): BlackjackState {
    return JSON.parse(JSON.stringify(state)) as BlackjackState;
}

function hideDealerIfNeeded(state: BlackjackState): { cards: Array<Card | null>; revealed: boolean } {
    const shouldHide = state.phase === 'playing' && !state.dealer.revealed;
    if (!shouldHide) {
        return { cards: [...state.dealer.cards], revealed: state.dealer.revealed };
    }
    return {
        cards: [state.dealer.cards[0] || null, null],
        revealed: false,
    };
}

export const blackjackPlugin: GamePlugin = {
    id: 'blackjack',
    name: '블랙잭',
    minPlayers: 1,
    maxPlayers: 6,

    createInitialState(players: Player[], config?: any): BlackjackState {
        const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);

        return {
            players: sortedPlayers.map((p) => ({
                id: p.id,
                nickname: p.nickname,
                seat: p.seat,
                hands: [],
                bet: 0,
                totalWinnings: 0,
                ready: false,
            })),
            dealer: { cards: [], revealed: false },
            deck: createDeck(),
            phase: 'betting',
            currentPlayerIndex: 0,
            currentHandIndex: 0,
            config: {
                minBet: config?.minBet ?? 10,
                maxBet: config?.maxBet ?? 10000,
            },
        };
    },

    validateAction(state: BlackjackState, action: GameAction, playerId: string): ValidationResult {
        const player = state.players.find((p) => p.id === playerId);
        if (!player) {
            return { valid: false, error: '플레이어를 찾을 수 없습니다' };
        }

        if (state.phase === 'betting') {
            if (action.type !== 'bet') {
                return { valid: false, error: '베팅 단계에서는 bet만 가능합니다' };
            }
            const amount = action.payload?.amount;
            if (typeof amount !== 'number' || !Number.isFinite(amount) || amount % 1 !== 0) {
                return { valid: false, error: '베팅 금액은 정수여야 합니다' };
            }
            if (amount < state.config.minBet || amount > state.config.maxBet) {
                return { valid: false, error: `베팅 금액은 ${state.config.minBet} ~ ${state.config.maxBet} 사이여야 합니다` };
            }
            if (player.ready) {
                return { valid: false, error: '이미 베팅을 완료했습니다' };
            }
            return { valid: true };
        }

        if (state.phase !== 'playing') {
            return { valid: false, error: '현재 액션을 수행할 수 없는 단계입니다' };
        }

        const currentPlayer = state.players[state.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.id !== playerId) {
            return { valid: false, error: '당신의 턴이 아닙니다' };
        }

        const hand = currentPlayer.hands[state.currentHandIndex];
        if (!hand) {
            return { valid: false, error: '현재 핸드를 찾을 수 없습니다' };
        }

        if (isHandDone(hand)) {
            return { valid: false, error: '이미 종료된 핸드입니다' };
        }

        if (action.type === 'hit' || action.type === 'stand') {
            return { valid: true };
        }

        if (action.type === 'double') {
            if (hand.cards.length !== 2) {
                return { valid: false, error: '더블다운은 처음 2장일 때만 가능합니다' };
            }
            if (hand.doubled) {
                return { valid: false, error: '이미 더블다운한 핸드입니다' };
            }
            return { valid: true };
        }

        if (action.type === 'split') {
            if (hand.cards.length !== 2) {
                return { valid: false, error: '스플릿은 처음 2장일 때만 가능합니다' };
            }
            if (hand.cards[0].rank !== hand.cards[1].rank) {
                return { valid: false, error: '같은 숫자/문양의 카드 2장만 스플릿 가능합니다' };
            }
            return { valid: true };
        }

        if (action.type === 'new_round') {
            if (state.phase !== 'finished') {
                return { valid: false, error: '라운드가 끝난 후에만 새 라운드를 시작할 수 있습니다' };
            }
            return { valid: true };
        }

        return { valid: false, error: '유효하지 않은 액션입니다' };
    },

    applyAction(state: BlackjackState, action: GameAction, playerId: string): ActionResult {
        const newState = cloneState(state);
        const events: GameEvent[] = [];

        if (newState.phase === 'betting' && action.type === 'bet') {
            const player = newState.players.find((p) => p.id === playerId);
            if (!player) {
                return { newState, events };
            }

            const amount = action.payload?.amount as number;
            player.bet = amount;
            player.ready = true;

            events.push({
                type: 'bet_placed',
                playerId,
                payload: { amount },
            });

            const allReady = newState.players.every((p) => p.ready && p.bet > 0);
            if (allReady) {
                startDealing(newState, events);
                runPostActionPhases(newState, events);
            }

            return { newState, events };
        }

        // New round: reset for next hand, keep totalWinnings & players
        if (newState.phase === 'finished' && action.type === 'new_round') {
            newState.deck = createDeck();
            newState.dealer = { cards: [], revealed: false };
            newState.phase = 'betting';
            newState.currentPlayerIndex = 0;
            newState.currentHandIndex = 0;
            for (const p of newState.players) {
                p.hands = [];
                p.bet = 0;
                p.ready = false;
            }
            events.push({ type: 'new_round', payload: {} });
            return { newState, events };
        }

        if (newState.phase !== 'playing') {
            return { newState, events };
        }

        const player = newState.players[newState.currentPlayerIndex];
        const hand = player?.hands[newState.currentHandIndex];
        if (!player || !hand) {
            return { newState, events };
        }

        if (action.type === 'hit') {
            const card = drawCard(newState);
            hand.cards.push(card);
            const total = getHandValue(hand.cards).total;
            if (total > 21) {
                hand.busted = true;
                hand.stood = true;
            }

            events.push({
                type: 'hit',
                playerId,
                payload: {
                    handIndex: newState.currentHandIndex,
                    card,
                    total,
                    busted: hand.busted,
                },
            });

            if (hand.busted) {
                advanceTurnOrDealer(newState);
            }
        } else if (action.type === 'stand') {
            hand.stood = true;
            events.push({
                type: 'stand',
                playerId,
                payload: { handIndex: newState.currentHandIndex },
            });
            advanceTurnOrDealer(newState);
        } else if (action.type === 'double') {
            hand.bet *= 2;
            hand.doubled = true;

            const card = drawCard(newState);
            hand.cards.push(card);
            const total = getHandValue(hand.cards).total;
            if (total > 21) {
                hand.busted = true;
            }
            hand.stood = true;

            events.push({
                type: 'double',
                playerId,
                payload: {
                    handIndex: newState.currentHandIndex,
                    card,
                    total,
                    busted: hand.busted,
                    newBet: hand.bet,
                },
            });

            advanceTurnOrDealer(newState);
        } else if (action.type === 'split') {
            const original = hand;
            const leftCards = [original.cards[0], drawCard(newState)];
            const rightCards = [original.cards[1], drawCard(newState)];

            const left: BlackjackHand = {
                cards: leftCards,
                bet: original.bet,
                stood: false,
                busted: false,
                blackjack: isBlackjack(leftCards),
                doubled: false,
            };
            const right: BlackjackHand = {
                cards: rightCards,
                bet: original.bet,
                stood: false,
                busted: false,
                blackjack: isBlackjack(rightCards),
                doubled: false,
            };

            player.hands.splice(newState.currentHandIndex, 1, left, right);

            events.push({
                type: 'split',
                playerId,
                payload: {
                    handIndex: newState.currentHandIndex,
                    newHands: [left.cards, right.cards],
                },
            });

            if (isHandDone(player.hands[newState.currentHandIndex])) {
                advanceTurnOrDealer(newState);
            }
        }

        runPostActionPhases(newState, events);
        return { newState, events };
    },

    getCurrentTurn(state: BlackjackState): string | null {
        if (state.phase !== 'playing') return null;
        return state.players[state.currentPlayerIndex]?.id || null;
    },

    isGameOver(state: BlackjackState): boolean {
        // Never auto-end room — blackjack supports continuous rounds via new_round action
        return false;
    },

    getResult(state: BlackjackState): GameResult | null {
        if (state.phase !== 'finished') {
            return null;
        }

        const scores = Object.fromEntries(state.players.map((p) => [p.id, p.totalWinnings]));
        let winnerId: string | undefined;

        if (state.players.length > 0) {
            const sorted = [...state.players].sort((a, b) => b.totalWinnings - a.totalWinnings);
            if (sorted[0].totalWinnings > 0) {
                winnerId = sorted[0].id;
            }
        }

        return {
            winnerId,
            scores,
            reason: '블랙잭 라운드 정산 완료',
        };
    },

    getPublicState(state: BlackjackState): any {
        return {
            players: state.players,
            dealer: hideDealerIfNeeded(state),
            phase: state.phase,
            currentPlayerIndex: state.currentPlayerIndex,
            currentHandIndex: state.currentHandIndex,
            config: state.config,
            deckCount: state.deck.length,
        };
    },

    getPlayerView(state: BlackjackState, playerId: string): any {
        const me = state.players.find((p) => p.id === playerId) || null;

        return {
            ...this.getPublicState(state),
            me,
            isMyTurn: state.phase === 'playing' && state.players[state.currentPlayerIndex]?.id === playerId,
        };
    },

    getTimeoutAction(state: BlackjackState, playerId: string): GameAction | null {
        if (state.phase !== 'playing') return null;
        const currentPlayer = state.players[state.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.id !== playerId) return null;
        return { type: 'stand' };
    },
};
