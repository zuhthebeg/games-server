/**
 * Enhance Battle Game Plugin
 * 무기 강화 배틀 - 2인 턴제 대전
 * 
 * Features:
 * - Rock-Paper-Scissors attack system (강타 > 빠른공격 > 정밀타격 > 강타)
 * - Element advantage system (Fire > Wind > Earth > Water > Fire)
 * - Hidden defense (opponent can't see your defense state)
 * - Weapon betting (loser loses weapon, winner gets sale price)
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

// Grade multipliers and sale prices
const GRADES: Record<string, { multiplier: number; basePrice: number }> = {
    common: { multiplier: 1.0, basePrice: 100 },
    magic: { multiplier: 1.3, basePrice: 500 },
    rare: { multiplier: 1.7, basePrice: 2000 },
    legendary: { multiplier: 2.2, basePrice: 10000 },
    unique: { multiplier: 3.0, basePrice: 50000 }
};

// Element advantage system (circular)
// fire > ice > lightning > fire (triangle)
// holy > poison > silver > holy (triangle)  
// Cross advantages: fire/ice/lightning beat poison/silver/holy
const ELEMENT_ADVANTAGE: Record<string, string[]> = {
    fire: ['ice', 'poison'],
    ice: ['lightning', 'silver'],
    lightning: ['fire', 'holy'],
    holy: ['poison', 'fire'],
    poison: ['silver', 'ice'],
    silver: ['holy', 'lightning']
};

// Attack types: Rock-Paper-Scissors
// strong > quick > precise > strong
const ATTACK_ADVANTAGE: Record<string, string> = {
    strong: 'quick',    // 강타 > 빠른공격
    quick: 'precise',   // 빠른공격 > 정밀타격
    precise: 'strong'   // 정밀타격 > 강타
};

interface WeaponData {
    type: string;
    grade: string;
    level: number;
    name: string;
    icon: string;
    element?: string;
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
    weaponElement: string | null;
    weaponSalePrice: number;
    // Combat stats
    hp: number;
    maxHp: number;
    damageMin: number;
    damageMax: number;
    critChance: number;
    critDamage: number;
    // Battle state (hidden from opponent)
    selectedAction: string | null;  // 'strong', 'quick', 'precise', 'defend'
    isDefending: boolean;
    counterReady: boolean;
}

interface AnimationEvent {
    type: 'attack' | 'defend' | 'damage' | 'crit' | 'counter';
    attackerId: string;
    defenderId?: string;
    damage?: number;
    attackType?: string;
    isCrit?: boolean;
    isCounter?: boolean;
    advantage?: string;  // 'type' | 'element' | 'both' | null
}

interface EnhanceState {
    players: BattlePlayer[];
    phase: 'select' | 'resolve';  // Both select, then resolve
    round: number;
    log: { type: string; text: string }[];
    animations: AnimationEvent[];  // For client-side animation
    winner: string | null;
    gameOver: boolean;
    // Prize is loser's weapon sale price
}

function calculateSalePrice(weapon: WeaponData): number {
    const gradeInfo = GRADES[weapon.grade] || GRADES.common;
    const levelBonus = weapon.level * 200;
    return gradeInfo.basePrice + levelBonus;
}

function getWeaponStats(weapon: WeaponData) {
    const typeBonus = WEAPON_TYPES[weapon.type] || { damage: 1.0, crit: 1.0 };
    const gradeInfo = GRADES[weapon.grade] || GRADES.common;
    const gradeMultiplier = gradeInfo.multiplier;
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

function createBattlePlayer(player: Player, weapon: WeaponData): BattlePlayer {
    const stats = getWeaponStats(weapon);
    const salePrice = calculateSalePrice(weapon);
    return {
        id: player.id,
        seat: player.seat,
        nickname: player.nickname,
        weaponType: weapon.type || 'sword',
        weaponGrade: weapon.grade || 'common',
        weaponLevel: weapon.level || 0,
        weaponName: weapon.name || '무기',
        weaponIcon: weapon.icon || '🗡️',
        weaponElement: weapon.element || null,
        weaponSalePrice: salePrice,
        hp: stats.hp,
        maxHp: stats.maxHp,
        damageMin: stats.damageMin,
        damageMax: stats.damageMax,
        critChance: stats.critChance,
        critDamage: stats.critDamage,
        selectedAction: null,
        isDefending: false,
        counterReady: false
    };
}

function rollDamage(player: BattlePlayer, isCounter: boolean = false): { damage: number; isCrit: boolean } {
    const baseDamage = Math.floor(Math.random() * (player.damageMax - player.damageMin + 1)) + player.damageMin;
    const critChance = isCounter ? Math.min(80, player.critChance + 20) : player.critChance;
    const isCrit = Math.random() * 100 < critChance;
    let damage = isCrit ? Math.floor(baseDamage * player.critDamage / 100) : baseDamage;
    if (isCounter) {
        damage = Math.floor(damage * 1.3);
    }
    return { damage, isCrit };
}

function getAttackAdvantage(attackerAction: string, defenderAction: string): number {
    // Returns damage multiplier based on attack type matchup
    if (defenderAction === 'defend') return 1.0;  // Defense doesn't participate in RPS
    
    if (ATTACK_ADVANTAGE[attackerAction] === defenderAction) {
        return 1.3;  // Advantage: +30% damage
    } else if (ATTACK_ADVANTAGE[defenderAction] === attackerAction) {
        return 0.7;  // Disadvantage: -30% damage
    }
    return 1.0;  // Neutral
}

function getElementAdvantage(attackerElement: string | null, defenderElement: string | null): number {
    if (!attackerElement || attackerElement === 'none') return 1.0;
    if (!defenderElement || defenderElement === 'none') return 1.0;
    
    const advantages = ELEMENT_ADVANTAGE[attackerElement] || [];
    const defenderAdvantages = ELEMENT_ADVANTAGE[defenderElement] || [];
    
    if (advantages.includes(defenderElement)) {
        return 1.2;  // Element advantage: +20% damage
    } else if (defenderAdvantages.includes(attackerElement)) {
        return 0.8;  // Element disadvantage: -20% damage
    }
    return 1.0;
}

export const enhanceGame: GamePlugin = {
    id: 'enhance',
    name: '무기 배틀',
    minPlayers: 2,
    maxPlayers: 2,
    
    createInitialState(players: Player[], config?: any): EnhanceState {
        const weaponData = config?.weapons || {};
        
        const battlePlayers = players.map(p => {
            const weapon: WeaponData = weaponData[p.id] || { 
                type: 'sword', grade: 'common', level: 0, name: '기본 검', icon: '🗡️' 
            };
            return createBattlePlayer(p, weapon);
        });

        return {
            players: battlePlayers,
            phase: 'select',
            round: 1,
            log: [
                { type: 'info', text: `⚔️ 무기 배틀 시작!` },
                { type: 'info', text: `🎯 공격 타입을 선택하세요! (강타/빠른공격/정밀타격/방어)` }
            ],
            animations: [],
            winner: null,
            gameOver: false
        };
    },

    validateAction(state: EnhanceState, action: GameAction, playerId: string): ValidationResult {
        if (state.gameOver) {
            return { valid: false, error: '게임이 이미 종료되었습니다' };
        }

        const player = state.players.find(p => p.id === playerId);
        if (!player) {
            return { valid: false, error: '플레이어를 찾을 수 없습니다' };
        }

        if (state.phase === 'select') {
            if (player.selectedAction !== null) {
                return { valid: false, error: '이미 행동을 선택했습니다' };
            }
            
            const validActions = ['strong', 'quick', 'precise', 'defend'];
            if (!validActions.includes(action.type)) {
                return { valid: false, error: '유효하지 않은 행동입니다' };
            }
        }

        return { valid: true };
    },

    applyAction(state: EnhanceState, action: GameAction, playerId: string): ActionResult {
        const newState: EnhanceState = JSON.parse(JSON.stringify(state));
        const events: GameEvent[] = [];

        const player = newState.players.find(p => p.id === playerId)!;
        const opponent = newState.players.find(p => p.id !== playerId)!;

        if (newState.phase === 'select') {
            // Player selects their action
            player.selectedAction = action.type;
            
            newState.log.push({ 
                type: 'info', 
                text: `✅ ${player.nickname} 행동 선택 완료!` 
            });

            // Check if both players have selected
            if (newState.players.every(p => p.selectedAction !== null)) {
                // Resolve phase
                newState.phase = 'resolve';
                
                const p1 = newState.players[0];
                const p2 = newState.players[1];
                
                // Get action names in Korean
                const actionNames: Record<string, string> = {
                    strong: '강타',
                    quick: '빠른공격',
                    precise: '정밀타격',
                    defend: '방어'
                };
                
                newState.log.push({ 
                    type: 'info', 
                    text: `🎲 ${p1.nickname}: ${actionNames[p1.selectedAction!]} vs ${p2.nickname}: ${actionNames[p2.selectedAction!]}` 
                });

                // Clear previous animations
                newState.animations = [];

                // Process attacks for each player
                for (const attacker of [p1, p2]) {
                    const defender = attacker === p1 ? p2 : p1;
                    
                    if (attacker.selectedAction === 'defend') {
                        attacker.isDefending = true;
                        newState.log.push({ 
                            type: 'info', 
                            text: `🛡️ ${attacker.nickname} 방어 태세!` 
                        });
                        newState.animations.push({
                            type: 'defend',
                            attackerId: attacker.id,
                            attackType: 'defend'
                        });
                        continue;
                    }

                    // Calculate damage with all modifiers
                    const isCounter = attacker.counterReady;
                    attacker.counterReady = false;
                    
                    const { damage: baseDamage, isCrit } = rollDamage(attacker, isCounter);
                    
                    // Attack type advantage
                    const attackAdvantage = getAttackAdvantage(attacker.selectedAction!, defender.selectedAction!);
                    
                    // Element advantage
                    const elementAdvantage = getElementAdvantage(attacker.weaponElement, defender.weaponElement);
                    
                    let finalDamage = Math.floor(baseDamage * attackAdvantage * elementAdvantage);
                    let damageLog = '';
                    
                    // Check if defender is defending
                    if (defender.isDefending) {
                        const defenseRoll = Math.random() * 100;
                        const defenseChance = 60;
                        
                        if (defenseRoll < defenseChance) {
                            finalDamage = Math.floor(finalDamage / 2);
                            defender.counterReady = true;
                            damageLog = ` (방어 성공! 카운터 준비)`;
                        } else {
                            finalDamage = Math.floor(finalDamage * 0.75);
                            damageLog = ` (부분 방어)`;
                        }
                        defender.isDefending = false;
                    }

                    defender.hp = Math.max(0, defender.hp - finalDamage);
                    
                    // Lifesteal effect - heal 15% of damage dealt
                    let lifestealHeal = 0;
                    if (attacker.weaponElement === 'lifesteal') {
                        lifestealHeal = Math.floor(finalDamage * 0.15);
                        const oldHp = attacker.hp;
                        attacker.hp = Math.min(attacker.maxHp, attacker.hp + lifestealHeal);
                        lifestealHeal = attacker.hp - oldHp;  // Actual heal amount
                    }
                    
                    // Build log message
                    let logText = '';
                    const attackType = actionNames[attacker.selectedAction!];
                    
                    if (isCounter && isCrit) {
                        logText = `⚡💥 ${attacker.nickname}의 카운터 크리티컬 ${attackType}! ${finalDamage} 데미지!`;
                    } else if (isCounter) {
                        logText = `⚡ ${attacker.nickname}의 카운터 ${attackType}! ${finalDamage} 데미지!`;
                    } else if (isCrit) {
                        logText = `💥 ${attacker.nickname}의 크리티컬 ${attackType}! ${finalDamage} 데미지!`;
                    } else {
                        logText = `⚔️ ${attacker.nickname}의 ${attackType}! ${finalDamage} 데미지!`;
                    }
                    
                    // Add advantage info
                    if (attackAdvantage > 1) {
                        logText += ` (타입 유리!)`;
                    } else if (attackAdvantage < 1) {
                        logText += ` (타입 불리)`;
                    }
                    
                    if (elementAdvantage > 1) {
                        logText += ` (속성 유리!)`;
                    } else if (elementAdvantage < 1) {
                        logText += ` (속성 불리)`;
                    }
                    
                    if (lifestealHeal > 0) {
                        logText += ` 🩸+${lifestealHeal} 흡혈!`;
                    }
                    
                    logText += damageLog;
                    
                    newState.log.push({ 
                        type: isCrit ? 'crit' : 'damage', 
                        text: logText 
                    });

                    // Add animation event
                    let advantage: string | undefined = undefined;
                    if (attackAdvantage > 1 && elementAdvantage > 1) advantage = 'both';
                    else if (attackAdvantage > 1) advantage = 'type';
                    else if (elementAdvantage > 1) advantage = 'element';

                    newState.animations.push({
                        type: isCounter ? 'counter' : (isCrit ? 'crit' : 'attack'),
                        attackerId: attacker.id,
                        defenderId: defender.id,
                        damage: finalDamage,
                        attackType: attacker.selectedAction!,
                        isCrit,
                        isCounter,
                        advantage
                    });
                }

                // Check for winner (after both attacks)
                const deadPlayers = newState.players.filter(p => p.hp <= 0);
                
                if (deadPlayers.length === 2) {
                    // Both died - tie, but lower HP loses
                    const winner = newState.players.reduce((a, b) => a.hp >= b.hp ? a : b);
                    newState.winner = winner.id;
                    newState.gameOver = true;
                } else if (deadPlayers.length === 1) {
                    const winner = newState.players.find(p => p.hp > 0)!;
                    const loser = deadPlayers[0];
                    newState.winner = winner.id;
                    newState.gameOver = true;
                    
                    newState.log.push({ 
                        type: 'info', 
                        text: `🏆 ${winner.nickname} 승리!` 
                    });
                    newState.log.push({ 
                        type: 'info', 
                        text: `💰 ${loser.weaponName} 판매가 ${loser.weaponSalePrice.toLocaleString()}G 획득!` 
                    });

                    events.push({
                        type: 'game_end',
                        payload: {
                            winnerId: winner.id,
                            winnerNickname: winner.nickname,
                            loserId: loser.id,
                            loserNickname: loser.nickname,
                            prizeGold: loser.weaponSalePrice,
                            loserLostWeapon: true
                        }
                    });
                }

                // If game not over, reset for next round
                if (!newState.gameOver) {
                    newState.round++;
                    newState.phase = 'select';
                    newState.players.forEach(p => {
                        p.selectedAction = null;
                        p.isDefending = false;
                    });
                    
                    newState.log.push({ 
                        type: 'info', 
                        text: `--- 라운드 ${newState.round} ---` 
                    });
                }
            }
        }

        events.push({
            type: 'state_update',
            payload: newState
        });

        return { newState, events };
    },

    getCurrentTurn(state: EnhanceState): string | null {
        // In simultaneous selection, all players can act
        if (state.gameOver) return null;
        
        // In select phase, return any player who hasn't selected
        if (state.phase === 'select') {
            const waiting = state.players.find(p => p.selectedAction === null);
            return waiting?.id || 'waiting';  // Return 'waiting' if all selected, waiting for resolve
        }
        
        return null;  // Resolve phase - no one can act
    },

    isGameOver(state: EnhanceState): boolean {
        return state.gameOver;
    },

    getResult(state: EnhanceState): GameResult | null {
        if (!state.gameOver) return null;
        const loser = state.players.find(p => p.id !== state.winner);
        return {
            winnerId: state.winner || undefined,
            reason: 'knockout',
            prizeGold: loser?.weaponSalePrice || 0
        };
    },

    getPublicState(state: EnhanceState): any {
        // Hide selected actions until both have selected
        const publicState = JSON.parse(JSON.stringify(state));
        if (state.phase === 'select') {
            publicState.players.forEach((p: any) => {
                p.selectedAction = p.selectedAction ? 'selected' : null;
            });
        }
        return publicState;
    },

    getPlayerView(state: EnhanceState, playerId: string): any {
        // Each player can only see their own selected action
        // and whether opponent has selected (but not what)
        const view = JSON.parse(JSON.stringify(state));
        
        if (state.phase === 'select') {
            view.players.forEach((p: any) => {
                if (p.id !== playerId) {
                    // Hide opponent's selection
                    p.selectedAction = p.selectedAction ? 'ready' : null;
                    // Hide opponent's defending state
                    p.isDefending = false;
                    p.counterReady = false;
                }
            });
        }
        
        return view;
    }
};
