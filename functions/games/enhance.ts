/**
 * Enhance Battle Game Plugin
 * 무기 강화 배틀 - 2인 턴제 대전
 */

import { GamePlugin, Player, GameAction, GameEvent, GameResult, ValidationResult, ActionResult } from './types';

interface BattlePlayer {
    id: string;
    seat: number;
    nickname: string;
    weaponLevel: number;
    hp: number;
    maxHp: number;
    damageMin: number;
    damageMax: number;
    critChance: number;
    critDamage: number;
    isDefending: boolean;
}

interface EnhanceState {
    players: BattlePlayer[];
    currentTurn: string;
    round: number;
    log: { type: string; text: string }[];
    winner: string | null;
    gameOver: boolean;
}

function getWeaponStats(level: number) {
    const baseDamageMin = 10;
    const baseDamageMax = 15;
    const damagePerLevel = 5;
    const baseCritChance = 5;
    const critPerLevel = 2;
    const baseCritDamage = 150;
    const critDamagePerLevel = 5;

    return {
        damageMin: baseDamageMin + (level * damagePerLevel),
        damageMax: baseDamageMax + (level * damagePerLevel),
        critChance: Math.min(50, baseCritChance + (level * critPerLevel)),
        critDamage: baseCritDamage + (level * critDamagePerLevel),
        hp: 100 + (level * 20),
        maxHp: 100 + (level * 20)
    };
}

function createBattlePlayer(player: Player, weaponLevel: number): BattlePlayer {
    const stats = getWeaponStats(weaponLevel);
    return {
        id: player.id,
        seat: player.seat,
        nickname: player.nickname,
        weaponLevel,
        hp: stats.hp,
        maxHp: stats.maxHp,
        damageMin: stats.damageMin,
        damageMax: stats.damageMax,
        critChance: stats.critChance,
        critDamage: stats.critDamage,
        isDefending: false
    };
}

function rollDamage(player: BattlePlayer): { damage: number; isCrit: boolean } {
    const baseDamage = Math.floor(Math.random() * (player.damageMax - player.damageMin + 1)) + player.damageMin;
    const isCrit = Math.random() * 100 < player.critChance;
    const damage = isCrit ? Math.floor(baseDamage * player.critDamage / 100) : baseDamage;
    return { damage, isCrit };
}

export const enhanceGame: GamePlugin = {
    id: 'enhance',
    name: '무기 배틀',
    minPlayers: 2,
    maxPlayers: 2,
    
    createInitialState(players: Player[], config?: any): EnhanceState {
        // Get weapon levels from config (stored by client before game start)
        const weaponLevels = config?.weaponLevels || {};
        
        const battlePlayers = players.map(p => {
            const level = weaponLevels[p.id] || 0;
            return createBattlePlayer(p, level);
        });

        // Random first turn
        const firstTurn = battlePlayers[Math.floor(Math.random() * battlePlayers.length)].id;

        return {
            players: battlePlayers,
            currentTurn: firstTurn,
            round: 1,
            log: [{ type: 'info', text: `⚔️ 배틀 시작! ${battlePlayers.find(p => p.id === firstTurn)?.nickname}의 선공!` }],
            winner: null,
            gameOver: false
        };
    },

    validateAction(state: EnhanceState, action: GameAction, playerId: string): ValidationResult {
        if (state.currentTurn !== playerId) {
            return { valid: false, error: '상대방의 턴입니다' };
        }

        if (state.gameOver) {
            return { valid: false, error: '게임이 이미 종료되었습니다' };
        }

        if (action.type !== 'attack' && action.type !== 'defend') {
            return { valid: false, error: '알 수 없는 액션입니다' };
        }

        return { valid: true };
    },

    applyAction(state: EnhanceState, action: GameAction, playerId: string): ActionResult {
        // Deep copy state
        const newState: EnhanceState = JSON.parse(JSON.stringify(state));
        const events: GameEvent[] = [];

        const attacker = newState.players.find(p => p.id === playerId)!;
        const defender = newState.players.find(p => p.id !== playerId)!;

        // Reset attacker's defending state
        attacker.isDefending = false;

        if (action.type === 'attack') {
            const { damage, isCrit } = rollDamage(attacker);
            let finalDamage = damage;

            // Defending reduces damage by 50%
            if (defender.isDefending) {
                finalDamage = Math.floor(damage / 2);
                newState.log.push({ 
                    type: 'info', 
                    text: `🛡️ ${defender.nickname}의 방어로 피해 50% 감소!` 
                });
            }

            defender.hp = Math.max(0, defender.hp - finalDamage);

            if (isCrit) {
                newState.log.push({ 
                    type: 'crit', 
                    text: `💥 ${attacker.nickname}의 크리티컬! ${finalDamage} 데미지!` 
                });
            } else {
                newState.log.push({ 
                    type: 'damage', 
                    text: `⚔️ ${attacker.nickname}의 공격! ${finalDamage} 데미지!` 
                });
            }

            // Check for winner
            if (defender.hp <= 0) {
                newState.winner = attacker.id;
                newState.gameOver = true;
                newState.log.push({ 
                    type: 'info', 
                    text: `🏆 ${attacker.nickname} 승리!` 
                });

                events.push({
                    type: 'game_end',
                    payload: {
                        winnerId: attacker.id,
                        winnerNickname: attacker.nickname,
                        loserId: defender.id,
                        loserNickname: defender.nickname
                    }
                });
            }

        } else if (action.type === 'defend') {
            attacker.isDefending = true;
            newState.log.push({ 
                type: 'info', 
                text: `🛡️ ${attacker.nickname}이(가) 방어 태세!` 
            });
        }

        // Switch turn if game not over
        if (!newState.gameOver) {
            newState.currentTurn = defender.id;

            // Increment round when back to first player
            if (newState.currentTurn === newState.players[0].id) {
                newState.round++;
            }
        }

        // Always send state update
        events.push({
            type: 'state_update',
            payload: newState
        });

        return { newState, events };
    },

    getCurrentTurn(state: EnhanceState): string | null {
        return state.gameOver ? null : state.currentTurn;
    },

    isGameOver(state: EnhanceState): boolean {
        return state.gameOver;
    },

    getResult(state: EnhanceState): GameResult | null {
        if (!state.gameOver) return null;
        return {
            winnerId: state.winner || undefined,
            reason: 'knockout'
        };
    },

    getPublicState(state: EnhanceState): any {
        return state;
    },

    getPlayerView(state: EnhanceState, playerId: string): any {
        return state;
    }
};
