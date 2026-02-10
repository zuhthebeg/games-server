/**
 * Enhance Battle Game Plugin
 * 무기 강화 배틀 - 2인 턴제 대전
 * 
 * Features:
 * - Weapon grades (common, magic, rare, legendary, unique)
 * - Weapon types with bonuses
 * - Defense with counter-attack
 * - Gold betting
 */

import { GamePlugin, Player, GameAction, GameEvent, GameResult, ValidationResult, ActionResult } from './types';

// Weapon type bonuses
const WEAPON_TYPES: Record<string, { damage: number; crit: number }> = {
    sword: { damage: 1.0, crit: 1.0 },
    axe: { damage: 1.15, crit: 0.9 },
    spear: { damage: 0.95, crit: 1.1 },
    hammer: { damage: 1.2, crit: 0.85 },
    dagger: { damage: 0.85, crit: 1.25 },
    staff: { damage: 0.9, crit: 1.0 },
    katana: { damage: 1.05, crit: 1.15 },
    scythe: { damage: 1.1, crit: 1.05 }
};

// Grade multipliers
const GRADES: Record<string, number> = {
    common: 1.0,
    magic: 1.3,
    rare: 1.7,
    legendary: 2.2,
    unique: 3.0
};

interface WeaponData {
    type: string;
    grade: string;
    level: number;
    name: string;
    icon: string;
}

interface BattlePlayer {
    id: string;
    seat: number;
    nickname: string;
    // Weapon info
    weaponType: string;
    weaponGrade: string;
    weaponLevel: number;
    weaponName: string;
    weaponIcon: string;
    // Combat stats
    hp: number;
    maxHp: number;
    damageMin: number;
    damageMax: number;
    critChance: number;
    critDamage: number;
    // Battle state
    isDefending: boolean;
    counterReady: boolean;  // Next attack is counter
    // Gold
    betGold: number;
}

interface EnhanceState {
    players: BattlePlayer[];
    currentTurn: string;
    round: number;
    log: { type: string; text: string }[];
    winner: string | null;
    gameOver: boolean;
    totalPrize: number;
}

function getWeaponStats(weapon: WeaponData) {
    const typeBonus = WEAPON_TYPES[weapon.type] || { damage: 1.0, crit: 1.0 };
    const gradeMultiplier = GRADES[weapon.grade] || 1.0;
    const level = weapon.level || 0;

    const baseDamageMin = 10;
    const baseDamageMax = 15;
    const damagePerLevel = 5;
    const baseCritChance = 5;
    const critPerLevel = 2;
    const baseCritDamage = 150;
    const critDamagePerLevel = 5;

    const damageMin = Math.floor((baseDamageMin + level * damagePerLevel) * gradeMultiplier * typeBonus.damage);
    const damageMax = Math.floor((baseDamageMax + level * damagePerLevel) * gradeMultiplier * typeBonus.damage);
    const critChance = Math.min(60, Math.floor((baseCritChance + level * critPerLevel) * typeBonus.crit));
    const critDamage = baseCritDamage + level * critDamagePerLevel;
    const hp = Math.floor((100 + level * 20) * gradeMultiplier);

    return { damageMin, damageMax, critChance, critDamage, hp, maxHp: hp };
}

function createBattlePlayer(player: Player, weapon: WeaponData, betGold: number): BattlePlayer {
    const stats = getWeaponStats(weapon);
    return {
        id: player.id,
        seat: player.seat,
        nickname: player.nickname,
        weaponType: weapon.type || 'sword',
        weaponGrade: weapon.grade || 'common',
        weaponLevel: weapon.level || 0,
        weaponName: weapon.name || '무기',
        weaponIcon: weapon.icon || '🗡️',
        hp: stats.hp,
        maxHp: stats.maxHp,
        damageMin: stats.damageMin,
        damageMax: stats.damageMax,
        critChance: stats.critChance,
        critDamage: stats.critDamage,
        isDefending: false,
        counterReady: false,
        betGold: betGold
    };
}

function rollDamage(player: BattlePlayer, isCounter: boolean = false): { damage: number; isCrit: boolean } {
    const baseDamage = Math.floor(Math.random() * (player.damageMax - player.damageMin + 1)) + player.damageMin;
    // Counter attacks have +20% crit chance
    const critChance = isCounter ? Math.min(80, player.critChance + 20) : player.critChance;
    const isCrit = Math.random() * 100 < critChance;
    // Counter attacks deal 1.3x damage
    let damage = isCrit ? Math.floor(baseDamage * player.critDamage / 100) : baseDamage;
    if (isCounter) {
        damage = Math.floor(damage * 1.3);
    }
    return { damage, isCrit };
}

export const enhanceGame: GamePlugin = {
    id: 'enhance',
    name: '무기 배틀',
    minPlayers: 2,
    maxPlayers: 2,
    
    createInitialState(players: Player[], config?: any): EnhanceState {
        // Get weapon data and gold from config
        const weaponData = config?.weapons || {};
        const goldData = config?.gold || {};
        
        const battlePlayers = players.map(p => {
            const weapon: WeaponData = weaponData[p.id] || { type: 'sword', grade: 'common', level: 0, name: '기본 검', icon: '🗡️' };
            const gold = goldData[p.id] || 1000;
            // Bet is minimum of their gold and 1000 (base bet)
            const betGold = Math.min(gold, 1000);
            return createBattlePlayer(p, weapon, betGold);
        });

        // Random first turn
        const firstTurn = battlePlayers[Math.floor(Math.random() * battlePlayers.length)].id;
        const totalPrize = battlePlayers.reduce((sum, p) => sum + p.betGold, 0);

        return {
            players: battlePlayers,
            currentTurn: firstTurn,
            round: 1,
            log: [
                { type: 'info', text: `💰 총 상금: ${totalPrize.toLocaleString()}G` },
                { type: 'info', text: `⚔️ 배틀 시작! ${battlePlayers.find(p => p.id === firstTurn)?.nickname}의 선공!` }
            ],
            winner: null,
            gameOver: false,
            totalPrize
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

        if (action.type === 'attack') {
            // Check if attacker has counter ready
            const isCounter = attacker.counterReady;
            attacker.counterReady = false;

            const { damage, isCrit } = rollDamage(attacker, isCounter);
            let finalDamage = damage;

            // If defender is defending, roll for defense success
            if (defender.isDefending) {
                const defenseRoll = Math.random() * 100;
                const defenseChance = 60; // 60% chance for perfect defense
                
                if (defenseRoll < defenseChance) {
                    // Perfect defense! 50% damage reduction + counter ready
                    finalDamage = Math.floor(damage / 2);
                    defender.counterReady = true;
                    newState.log.push({ 
                        type: 'info', 
                        text: `🛡️ ${defender.nickname}의 완벽한 방어! 피해 50% 감소 + 카운터 준비!` 
                    });
                } else {
                    // Partial defense - only 25% damage reduction, no counter
                    finalDamage = Math.floor(damage * 0.75);
                    newState.log.push({ 
                        type: 'info', 
                        text: `🛡️ ${defender.nickname}의 부분 방어! 피해 25% 감소` 
                    });
                }
                defender.isDefending = false;
            }

            // Apply damage (ensure HP doesn't go below 0)
            defender.hp = Math.max(0, defender.hp - finalDamage);

            if (isCounter && isCrit) {
                newState.log.push({ 
                    type: 'crit', 
                    text: `⚡ ${attacker.nickname}의 카운터 크리티컬! ${finalDamage} 데미지!` 
                });
            } else if (isCounter) {
                newState.log.push({ 
                    type: 'damage', 
                    text: `⚡ ${attacker.nickname}의 카운터 공격! ${finalDamage} 데미지!` 
                });
            } else if (isCrit) {
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

            // Reset attacker's defending state
            attacker.isDefending = false;

            // Check for winner
            if (defender.hp <= 0) {
                newState.winner = attacker.id;
                newState.gameOver = true;
                newState.log.push({ 
                    type: 'info', 
                    text: `🏆 ${attacker.nickname} 승리! +${newState.totalPrize.toLocaleString()}G` 
                });

                events.push({
                    type: 'game_end',
                    payload: {
                        winnerId: attacker.id,
                        winnerNickname: attacker.nickname,
                        loserId: defender.id,
                        loserNickname: defender.nickname,
                        prizeGold: newState.totalPrize
                    }
                });
            }

        } else if (action.type === 'defend') {
            attacker.isDefending = true;
            newState.log.push({ 
                type: 'info', 
                text: `🛡️ ${attacker.nickname}이(가) 방어 태세! (다음 피격시 카운터)` 
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
