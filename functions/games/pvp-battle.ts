/**
 * PvP Battle Game Plugin
 * 턴제 3액션 상성 시스템 (공격/방어/스킬)
 */
import type { GamePlugin, Player, GameAction, GameEvent, ValidationResult, ActionResult, GameResult } from './types';

interface PvPPlayer {
  id: string;
  nickname: string;
  seat: number;
  hp: number;
  maxHp: number;
  weaponDamage: number;
  damageMin: number;
  damageMax: number;
  weaponGrade: string;
  weaponElement: string;
  weaponName: string;
  weaponType: string;
  weaponLevel: number;
  weaponCritChance: number;
  weaponCritDamage: number;
  rage: number;
  isAwakened: boolean;
  actionHistory: string[];
  selectedAction: string | null;
  nextDamageBonus: number;  // 절대방어 다음턴 보너스
}

interface TurnResult {
  p1Action: string;
  p2Action: string;
  p1Damage: number;
  p2Damage: number;
  p1Crit: boolean;
  p2Crit: boolean;
  winner: 'p1' | 'p2' | 'draw' | null;
}

interface PvPState {
  players: PvPPlayer[];
  round: number;
  phase: 'select' | 'resolve' | 'ended';
  log: { text: string; type?: string }[];
  winnerId: string | null;
  lastTurnResult?: TurnResult;
}

// 상성: attack > skill > defense > attack
const ACTION_MATCHUP: Record<string, Record<string, 'win' | 'lose' | 'draw'>> = {
  attack: { attack: 'draw', defense: 'lose', skill: 'win' },
  defense: { attack: 'win', defense: 'draw', skill: 'lose' },
  skill: { attack: 'lose', defense: 'win', skill: 'draw' }
};

// 속성 상성
const ELEMENT_ADVANTAGE: Record<string, string[]> = {
  fire: ['ice', 'poison'],
  ice: ['lightning'],
  lightning: ['fire', 'holy'],
  holy: ['poison', 'lifesteal'],
  poison: ['lightning'],
  silver: ['lifesteal'],
  water: ['fire'],
  lifesteal: []
};

function getElementBonus(attacker: string, defender: string): number {
  if (!attacker || attacker === 'none' || !defender || defender === 'none') return 1.0;
  if (ELEMENT_ADVANTAGE[attacker]?.includes(defender)) return 1.2;
  if (ELEMENT_ADVANTAGE[defender]?.includes(attacker)) return 0.8;
  return 1.0;
}

// 🧙 마법 무기 체크
function isMagicWeapon(weaponType: string): boolean {
  return weaponType === 'staff' || weaponType === 'wand';
}

// 🧙 마법 크리티컬 효과 (PvP용)
// 반환: { extraDamage, healAmount, effectText }
function getMagicCritEffect(weaponType: string, element: string, baseDamage: number, maxHp: number): { extraDamage: number, healAmount: number, effectText: string } {
  if (!isMagicWeapon(weaponType)) return { extraDamage: 0, healAmount: 0, effectText: '' };
  
  switch (element) {
    case 'fire':  // 🔥 폭발: +50%
      return { extraDamage: Math.floor(baseDamage * 0.5), healAmount: 0, effectText: '🔥폭발!' };
    case 'ice':  // ❄️ 빙결: +30% (PvP에선 빙결 대신 데미지)
      return { extraDamage: Math.floor(baseDamage * 0.3), healAmount: 0, effectText: '❄️빙결!' };
    case 'lightning':  // ⚡ 감전: +30%
      return { extraDamage: Math.floor(baseDamage * 0.3), healAmount: 0, effectText: '⚡감전!' };
    case 'water':  // 💧 치유: HP 20% 회복
      return { extraDamage: 0, healAmount: Math.floor(maxHp * 0.2), effectText: '💧치유!' };
    case 'poison':  // ☠️ 맹독: +40% (PvP에선 DoT 대신 데미지)
      return { extraDamage: Math.floor(baseDamage * 0.4), healAmount: 0, effectText: '☠️맹독!' };
    case 'holy':  // ✨ 신성: +50% (PvP에선 즉사 대신 데미지)
      return { extraDamage: Math.floor(baseDamage * 0.5), healAmount: 0, effectText: '✨신성!' };
    default:
      return { extraDamage: 0, healAmount: 0, effectText: '' };
  }
}

function checkPatternRead(history: string[]): boolean {
  if (history.length < 3) return false;
  const last3 = history.slice(-3);
  return last3[0] === last3[1] && last3[1] === last3[2];
}

// 랜덤 데미지 계산 (사냥과 동일)
function getRandomDamage(player: PvPPlayer): number {
  const min = player.damageMin || 5;
  const max = player.damageMax || 8;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const pvpBattlePlugin: GamePlugin = {
  id: 'pvp-battle',
  name: '⚔️ 무기 배틀',
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState(players: Player[], config?: any): PvPState {
    const gamePlayers: PvPPlayer[] = players.map((p, idx) => {
      // playerData는 room_players.player_state에서 가져옴 (start.ts가 config.playerData에 넣어줌)
      const playerData = config?.playerData?.[p.id] || {};
      const weapon = playerData.weapon || config?.weapons?.[p.id] || { level: 0, grade: 'common', element: 'none', name: '기본 무기' };
      console.log(`[pvp-battle] Player ${p.id} weapon:`, JSON.stringify(weapon));
      
      const level = weapon.level || 0;
      
      // 클라이언트가 보낸 계산된 스탯 사용 (사냥과 동일한 공식)
      // NaN 방어: 숫자 아니면 기본값
      const rawDamageMin = Number(weapon.damageMin);
      const rawDamageMax = Number(weapon.damageMax);
      const rawHp = Number(weapon.hp);
      
      const damageMin = isNaN(rawDamageMin) || rawDamageMin <= 0 ? 5 : rawDamageMin;
      const damageMax = isNaN(rawDamageMax) || rawDamageMax <= 0 ? 8 : rawDamageMax;
      const weaponDamage = Math.floor((damageMin + damageMax) / 2);
      const maxHp = isNaN(rawHp) || rawHp <= 0 ? (100 + level * 20) : rawHp;
      
      console.log(`[pvp-battle] Player ${p.id} stats: dmg=${damageMin}-${damageMax}, hp=${maxHp}, raw weapon:`, JSON.stringify(weapon));

      return {
        id: p.id,
        nickname: p.nickname || `플레이어 ${idx + 1}`,
        seat: p.seat,
        hp: maxHp,
        maxHp,
        weaponDamage,
        damageMin,
        damageMax,
        weaponGrade: weapon.grade || 'common',
        weaponElement: weapon.element || 'none',
        weaponName: weapon.name || '무기',
        weaponType: weapon.type || 'sword',
        weaponLevel: level,
        weaponCritChance: weapon.critChance || 5,
        weaponCritDamage: weapon.critDamage || 150,
        rage: 0,
        isAwakened: false,
        actionHistory: [],
        selectedAction: null,
        nextDamageBonus: 1.0
      };
    });

    return {
      players: gamePlayers,
      round: 1,
      phase: 'select',
      log: [{ text: `⚔️ 배틀 시작!`, type: 'info' }],
      winnerId: null
    };
  },

  validateAction(state: PvPState, action: GameAction, playerId: string): ValidationResult {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return { valid: false, error: '플레이어를 찾을 수 없습니다' };
    if (state.phase !== 'select') return { valid: false, error: '선택 단계가 아닙니다' };
    if (player.selectedAction) return { valid: false, error: '이미 선택했습니다' };

    const validActions = ['attack', 'defense', 'skill'];
    const validUltimates = ['burst', 'lifedrain', 'absolute'];

    if (action.type === 'ultimate') {
      if (player.rage < 100) return { valid: false, error: '분노 게이지가 부족합니다' };
      if (!validUltimates.includes(action.payload?.ultimate)) {
        return { valid: false, error: '유효하지 않은 궁극기입니다' };
      }
    } else if (!validActions.includes(action.type)) {
      return { valid: false, error: '유효하지 않은 행동입니다' };
    }

    return { valid: true };
  },

  applyAction(state: PvPState, action: GameAction, playerId: string): ActionResult {
    const newState = JSON.parse(JSON.stringify(state)) as PvPState;
    const player = newState.players.find(p => p.id === playerId)!;
    const events: GameEvent[] = [];

    // 행동 선택
    if (action.type === 'ultimate') {
      player.selectedAction = `ultimate_${action.payload.ultimate}`;
    } else {
      player.selectedAction = action.type;
    }

    events.push({ type: 'action_selected', playerId });

    // 양쪽 다 선택했으면 턴 진행
    const allSelected = newState.players.every(p => p.selectedAction !== null);
    if (allSelected) {
      const turnResult = resolveTurn(newState);
      events.push(...turnResult.events);
    }

    return { newState, events };
  },

  getCurrentTurn(state: PvPState): string | null {
    // 동시 턴제이므로 null 반환 (모든 플레이어가 동시에 선택)
    return null;
  },

  isGameOver(state: PvPState): boolean {
    return state.phase === 'ended';
  },

  getResult(state: PvPState): GameResult | null {
    if (!state.winnerId) return null;
    const winner = state.players.find(p => p.id === state.winnerId);
    const loser = state.players.find(p => p.id !== state.winnerId);
    return {
      winnerId: state.winnerId,
      reason: `${winner?.nickname} 승리! (${state.round} 라운드)`
    };
  },

  getPublicState(state: PvPState): any {
    return {
      players: state.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        hp: p.hp || 100,
        maxHp: p.maxHp || 100,
        rage: p.rage || 0,
        isAwakened: p.isAwakened || false,
        weaponName: p.weaponName || '무기',
        weaponType: p.weaponType || 'sword',
        weaponGrade: p.weaponGrade || 'common',
        weaponElement: p.weaponElement || 'none',
        weaponLevel: p.weaponLevel || 0,
        weaponDamage: p.weaponDamage || 5,
        damageMin: p.damageMin || 5,
        damageMax: p.damageMax || 8,
        weaponCritChance: p.weaponCritChance || 5,
        weaponCritDamage: p.weaponCritDamage || 150,
        hasSelected: p.selectedAction !== null,
        actionHistory: p.actionHistory.slice(-3)
      })),
      round: state.round,
      phase: state.phase,
      log: state.log.slice(-10),
      winnerId: state.winnerId,
      lastTurnResult: state.lastTurnResult || null
    };
  },

  getPlayerView(state: PvPState, playerId: string): any {
    const publicState = this.getPublicState(state);
    const player = state.players.find(p => p.id === playerId);
    return {
      ...publicState,
      myAction: player?.selectedAction
    };
  }
};

function resolveTurn(state: PvPState): { events: GameEvent[] } {
  const [p1, p2] = state.players;
  const a1 = p1.selectedAction!;
  const a2 = p2.selectedAction!;
  const events: GameEvent[] = [];

  let p1Damage = 0, p2Damage = 0;
  let p1RageGain = 0, p2RageGain = 0;
  let p1Crit = false, p2Crit = false;
  let resultText = '';

  const p1Ultimate = a1.startsWith('ultimate_') ? a1.split('_')[1] : null;
  const p2Ultimate = a2.startsWith('ultimate_') ? a2.split('_')[1] : null;

  // 행동 기록 (궁극기 제외)
  if (!p1Ultimate) {
    p1.actionHistory.push(a1);
    if (p1.actionHistory.length > 3) p1.actionHistory.shift();
  }
  if (!p2Ultimate) {
    p2.actionHistory.push(a2);
    if (p2.actionHistory.length > 3) p2.actionHistory.shift();
  }

  // 간파 체크
  const p1Readable = checkPatternRead(p1.actionHistory);
  const p2Readable = checkPatternRead(p2.actionHistory);

  // 궁극기 소모
  if (p1Ultimate) p1.rage = 0;
  if (p2Ultimate) p2.rage = 0;

  // 속성/각성 보너스
  const elem1 = getElementBonus(p1.weaponElement, p2.weaponElement);
  const elem2 = getElementBonus(p2.weaponElement, p1.weaponElement);
  const awaken1 = p1.isAwakened ? 1.5 : 1.0;
  const awaken2 = p2.isAwakened ? 1.5 : 1.0;
  const bonus1 = p1.nextDamageBonus;
  const bonus2 = p2.nextDamageBonus;
  p1.nextDamageBonus = 1.0;
  p2.nextDamageBonus = 1.0;

  const actionNames: Record<string, string> = { attack: '⚔️공격', defense: '🛡️방어', skill: '🔮스킬' };

  if (p1Ultimate && !p2Ultimate) {
    const r = processUltimate(p1, p2, p1Ultimate, elem1, awaken1, bonus1);
    p2Damage = r.damage;
    if (r.heal) p1.hp = Math.min(p1.maxHp, p1.hp + r.heal);
    if (r.nextBonus) p1.nextDamageBonus = r.nextBonus;
    resultText = `${p1.nickname}의 ${r.name}! ${r.damage > 0 ? `${p2.nickname}에게 ${r.damage} 데미지` : ''}`;
    p2RageGain = 30;
  } else if (p2Ultimate && !p1Ultimate) {
    const r = processUltimate(p2, p1, p2Ultimate, elem2, awaken2, bonus2);
    p1Damage = r.damage;
    if (r.heal) p2.hp = Math.min(p2.maxHp, p2.hp + r.heal);
    if (r.nextBonus) p2.nextDamageBonus = r.nextBonus;
    resultText = `${p2.nickname}의 ${r.name}! ${r.damage > 0 ? `${p1.nickname}에게 ${r.damage} 데미지` : ''}`;
    p1RageGain = 30;
  } else if (p1Ultimate && p2Ultimate) {
    resultText = `⚡ 양쪽 궁극기 충돌! 상쇄!`;
    p1Damage = 10;
    p2Damage = 10;
  } else {
    // 일반 상성
    let matchResult: 'win' | 'lose' | 'draw';
    if (p1Readable && !p2Readable) {
      matchResult = 'lose';
      resultText = `⚠️ ${p1.nickname} 간파당함! `;
    } else if (p2Readable && !p1Readable) {
      matchResult = 'win';
      resultText = `⚠️ ${p2.nickname} 간파당함! `;
    } else {
      matchResult = ACTION_MATCHUP[a1][a2];
    }

    if (matchResult === 'win') {
      const mult = a1 === 'skill' ? 1.5 : (a1 === 'defense' ? 0.5 : 1.0);
      // 랜덤 데미지 + 크리티컬
      const baseDmg1 = getRandomDamage(p1);
      p1Crit = Math.random() * 100 < p1.weaponCritChance;
      // 🌟 신화 무기 슈퍼크리티컬 (1% 확률 즉사)
      const p1SuperCrit = p1.weaponGrade === 'mythic' && Math.random() < 0.01;
      const critMult1 = p1Crit ? (p1.weaponCritDamage / 100) : 1.0;
      p2Damage = p1SuperCrit ? p2.hp : Math.floor(baseDmg1 * mult * elem1 * awaken1 * bonus1 * critMult1);
      
      // 🧙 마법 무기 크리티컬 효과
      let magicEffectText1 = '';
      if (p1Crit && !p1SuperCrit) {
        const magicEffect = getMagicCritEffect(p1.weaponType, p1.weaponElement, p2Damage, p1.maxHp);
        p2Damage += magicEffect.extraDamage;
        if (magicEffect.healAmount > 0) {
          p1.hp = Math.min(p1.maxHp, p1.hp + magicEffect.healAmount);
        }
        magicEffectText1 = magicEffect.effectText;
      }
      
      p2RageGain = 30;
      resultText += `${p1.nickname}의 ${actionNames[a1]} 승리!${p1SuperCrit ? ` 🌟슈퍼크리티컬!! 즉사!` : (p1Crit ? ` 💥크리티컬(${p1.weaponCritDamage}%)!${magicEffectText1}` : '')} → ${p2Damage} 데미지`;
    } else if (matchResult === 'lose') {
      const mult = a2 === 'skill' ? 1.5 : (a2 === 'defense' ? 0.5 : 1.0);
      // 랜덤 데미지 + 크리티컬
      const baseDmg2 = getRandomDamage(p2);
      p2Crit = Math.random() * 100 < p2.weaponCritChance;
      // 🌟 신화 무기 슈퍼크리티컬 (1% 확률 즉사)
      const p2SuperCrit = p2.weaponGrade === 'mythic' && Math.random() < 0.01;
      const critMult2 = p2Crit ? (p2.weaponCritDamage / 100) : 1.0;
      p1Damage = p2SuperCrit ? p1.hp : Math.floor(baseDmg2 * mult * elem2 * awaken2 * bonus2 * critMult2);
      
      // 🧙 마법 무기 크리티컬 효과
      let magicEffectText2 = '';
      if (p2Crit && !p2SuperCrit) {
        const magicEffect = getMagicCritEffect(p2.weaponType, p2.weaponElement, p1Damage, p2.maxHp);
        p1Damage += magicEffect.extraDamage;
        if (magicEffect.healAmount > 0) {
          p2.hp = Math.min(p2.maxHp, p2.hp + magicEffect.healAmount);
        }
        magicEffectText2 = magicEffect.effectText;
      }
      
      p1RageGain = 30;
      resultText += `${p2.nickname}의 ${actionNames[a2]} 승리!${p2SuperCrit ? ` 🌟슈퍼크리티컬!! 즉사!` : (p2Crit ? ` 💥크리티컬(${p2.weaponCritDamage}%)!${magicEffectText2}` : '')} → ${p1Damage} 데미지`;
    } else {
      // 무승부 - 행동별 다른 처리
      if (a1 === 'attack' && a2 === 'attack') {
        // 공격 vs 공격: 무기 데미지 차이만큼 (강한 쪽이 약한 쪽에게)
        const dmg1 = Math.floor(getRandomDamage(p1) * elem1 * awaken1 * bonus1);
        const dmg2 = Math.floor(getRandomDamage(p2) * elem2 * awaken2 * bonus2);
        if (dmg1 > dmg2) {
          p2Damage = dmg1 - dmg2;
          p2RageGain = 15;
          resultText += `⚔️ 공격 충돌! ${p1.nickname}의 무기가 더 강력! → ${p2Damage} 데미지`;
        } else if (dmg2 > dmg1) {
          p1Damage = dmg2 - dmg1;
          p1RageGain = 15;
          resultText += `⚔️ 공격 충돌! ${p2.nickname}의 무기가 더 강력! → ${p1Damage} 데미지`;
        } else {
          // 데미지 완전 동일
          p1RageGain = 10;
          p2RageGain = 10;
          resultText += `⚔️ 공격 충돌! 완벽한 균형!`;
        }
      } else if (a1 === 'defense' && a2 === 'defense') {
        // 방어 vs 방어: 데미지 없음
        p1Damage = 0;
        p2Damage = 0;
        p1RageGain = 5;
        p2RageGain = 5;
        resultText += `🛡️ 양쪽 방어! 데미지 없음`;
      } else if (a1 === 'skill' && a2 === 'skill') {
        // 스킬 vs 스킬: 양쪽 100% 크리티컬!
        p1Crit = true;
        p2Crit = true;
        const critMult1 = p1.weaponCritDamage / 100;
        const critMult2 = p2.weaponCritDamage / 100;
        p1Damage = Math.floor(getRandomDamage(p2) * 1.5 * elem2 * awaken2 * bonus2 * critMult2);
        p2Damage = Math.floor(getRandomDamage(p1) * 1.5 * elem1 * awaken1 * bonus1 * critMult1);
        p1RageGain = 20;
        p2RageGain = 20;
        resultText += `🔮💥 스킬 충돌! 양쪽 크리티컬! ${p1.nickname}: ${p1Damage}, ${p2.nickname}: ${p2Damage}`;
      }
    }
  }

  // 데미지 적용
  p1.hp = Math.max(0, p1.hp - p1Damage);
  p2.hp = Math.max(0, p2.hp - p2Damage);

  // 분노 충전
  p1.rage = Math.min(100, p1.rage + p1RageGain);
  p2.rage = Math.min(100, p2.rage + p2RageGain);

  // 각성 체크
  const wasAwakened1 = p1.isAwakened;
  const wasAwakened2 = p2.isAwakened;
  p1.isAwakened = p1.hp > 0 && p1.hp <= p1.maxHp * 0.3;
  p2.isAwakened = p2.hp > 0 && p2.hp <= p2.maxHp * 0.3;

  // 로그
  state.log.push({ text: resultText, type: 'info' });
  if (p1.isAwakened && !wasAwakened1) state.log.push({ text: `⚡ ${p1.nickname} 각성!`, type: 'crit' });
  if (p2.isAwakened && !wasAwakened2) state.log.push({ text: `⚡ ${p2.nickname} 각성!`, type: 'crit' });

  // 턴 결과 저장 (클라이언트 애니메이션용)
  state.lastTurnResult = {
    p1Action: a1,
    p2Action: a2,
    p1Damage,
    p2Damage,
    p1Crit,
    p2Crit,
    winner: p2Damage > p1Damage ? 'p1' : (p1Damage > p2Damage ? 'p2' : 'draw')
  };

  // 선택 리셋
  p1.selectedAction = null;
  p2.selectedAction = null;

  // 게임 종료 체크
  if (p1.hp <= 0 || p2.hp <= 0) {
    state.phase = 'ended';
    state.winnerId = p1.hp > 0 ? p1.id : (p2.hp > 0 ? p2.id : null);
    const winner = state.players.find(p => p.id === state.winnerId);
    if (winner) {
      state.log.push({ text: `🏆 ${winner.nickname} 승리!`, type: 'success' });
    }
    events.push({ type: 'game_end', payload: { winnerId: state.winnerId, round: state.round } });
  } else {
    state.round++;
    state.log.push({ text: `⚔️ 라운드 ${state.round}`, type: 'info' });
    events.push({ type: 'turn_resolved', payload: { round: state.round - 1 } });
  }

  return { events };
}

function processUltimate(attacker: PvPPlayer, defender: PvPPlayer, type: string, elem: number, awaken: number, bonus: number): { damage: number; heal?: number; nextBonus?: number; name: string } {
  const baseDmg = getRandomDamage(attacker);
  switch (type) {
    case 'burst':
      return { damage: Math.floor(baseDmg * 2.0 * elem * awaken * bonus), name: '🔥 필살일격' };
    case 'lifedrain':
      const dmg = Math.floor(baseDmg * 1.0 * elem * awaken * bonus);
      return { damage: dmg, heal: dmg, name: '💚 생명흡수' };
    case 'absolute':
      return { damage: 0, nextBonus: 1.5, name: '🛡️ 절대방어' };
    default:
      return { damage: 0, name: '???' };
  }
}
