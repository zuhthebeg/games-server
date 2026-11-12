export const TALENT_MAX_RANK = 5;
export const TALENTS = {
  sword: [
    { id: 'sw-vigor', name: '강철 체력', stat: 'maxHpPct', perRank: 3 },
    { id: 'sw-edge', name: '날 선 검', stat: 'attackPct', perRank: 2 },
    { id: 'sw-counter', name: '반격의 달인', stat: 'counterDamagePct', perRank: 8 },
    { id: 'sw-bulwark', name: '철벽', stat: 'defense', perRank: 2 },
    { id: 'sw-tempo', name: '전투 호흡', stat: 'skillCooldownReduction', perRank: 2 },
    { id: 'sw-leech', name: '피의 검', stat: 'lifesteal', perRank: 0.6 },
  ],
  crossbow: [
    { id: 'cb-eye', name: '매의 눈', stat: 'critChance', perRank: 1.2 },
    { id: 'cb-vital', name: '급소 사격', stat: 'critDamage', perRank: 6 },
    { id: 'cb-rapid', name: '속사', stat: 'attackSpeed', perRank: 2 },
    { id: 'cb-stride', name: '경보', stat: 'moveSpeedPct', perRank: 1.5 },
    { id: 'cb-evade', name: '회피 기동', stat: 'dodgeCooldownReduction', perRank: 3 },
    { id: 'cb-bolt', name: '강철 화살', stat: 'attackPct', perRank: 2 },
  ],
  staff: [
    { id: 'st-focus', name: '마력 집중', stat: 'attackPct', perRank: 2.5 },
    { id: 'st-haste', name: '시전 가속', stat: 'skillCooldownReduction', perRank: 2.5 },
    { id: 'st-ward', name: '마나 보호막', stat: 'maxHpPct', perRank: 2.5 },
    { id: 'st-surge', name: '원소 폭주', stat: 'critDamage', perRank: 7 },
    { id: 'st-phase', name: '위상 이동', stat: 'dodgeCooldownReduction', perRank: 3 },
    { id: 'st-siphon', name: '영혼 흡수', stat: 'lifesteal', perRank: 0.6 },
  ],
};
export const RIFT_BOSS_TALENT_FLOORS = Object.freeze([5, 10, 15, 20, 25, 30]);

function boundedLevel(level) {
  return Number.isFinite(level) ? Math.max(1, Math.min(20, Math.trunc(level))) : 1;
}

export function talentPoints(character) {
  const clearedStages = new Set(Array.isArray(character?.clearedStages) ? character.clearedStages : []);
  return boundedLevel(character?.level) - 1
    + RIFT_BOSS_TALENT_FLOORS.filter((floor) => clearedStages.has(`R${floor}`)).length;
}

export function talentResetCost(level) {
  return 50 * boundedLevel(level);
}

export function normalizedTalents(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(TALENTS).map((family) => {
    const entries = source[family] && typeof source[family] === 'object' && !Array.isArray(source[family])
      ? Object.entries(source[family])
      : [];
    const knownIds = new Set(TALENTS[family].map(({ id }) => id));
    return [family, Object.fromEntries(entries.filter(([id, rank]) => (
      knownIds.has(id) && Number.isInteger(rank) && rank >= 1 && rank <= TALENT_MAX_RANK
    )))];
  }));
}

export function talentSpent(talents, family) {
  if (!Object.hasOwn(TALENTS, family)) return 0;
  return Object.values(normalizedTalents(talents)[family]).reduce((sum, rank) => sum + rank, 0);
}

export function talentsWithinBudget(character) {
  const points = talentPoints(character);
  return Object.keys(TALENTS).every((family) => talentSpent(character?.talents, family) <= points);
}
