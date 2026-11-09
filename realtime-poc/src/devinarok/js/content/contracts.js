import { ENEMIES } from './enemies.js';
import { DIFFICULTIES, isDifficultyUnlocked, isStageUnlocked, latestStage, STAGE_LIST, STAGES } from './stages.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const COMMON_TYPES = ['kills', 'perfect', 'clear'];
const TIERS = ['easy', 'normal', 'hard'];
const TIER_LABELS = { easy: '쉬움', normal: '보통', hard: '어려움' };
const ENEMY_LABELS = {
  minion: '해골 하수인',
  warrior: '해골 전사',
  rogue: '해골 도적',
  mage: '해골 마법사',
  ashcaller: '잿빛 소환사',
  bonearcher: '해골 궁수',
  brute: '무너진 거한',
  shieldbearer: '방패 병사',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function calendarDateFromDays(epochDays) {
  const shiftedDays = epochDays + 719468;
  const era = Math.floor(shiftedDays / 146097);
  const dayOfEra = shiftedDays - era * 146097;
  const yearOfEra = Math.floor((
    dayOfEra
    - Math.floor(dayOfEra / 1460)
    + Math.floor(dayOfEra / 36524)
    - Math.floor(dayOfEra / 146096)
  ) / 365);
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (
    365 * yearOfEra
    + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100)
  );
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart + (monthPart < 10 ? 3 : -9);
  year += Number(month <= 2);
  return { year, month, day };
}

export function kstDateKey(nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const date = calendarDateFromDays(Math.floor((Math.trunc(nowMs) + KST_OFFSET_MS) / DAY_MS));
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function unlockedStages(character, difficulty) {
  const clearedStages = Array.isArray(character?.clearedStages) ? character.clearedStages : [];
  return STAGE_LIST.filter((stage) => isStageUnlocked(stage.id, clearedStages, difficulty));
}

function highestUnlockedDifficulty(character) {
  const clearedStages = Array.isArray(character?.clearedStages) ? character.clearedStages : [];
  return Object.keys(DIFFICULTIES).reverse().find((difficulty) => (
    isDifficultyUnlocked(difficulty, clearedStages)
    && unlockedStages(character, difficulty).length > 0
  )) ?? 'normal';
}

function contractTypes(random, hasUnlockedBoss) {
  const hardChoices = hasUnlockedBoss ? [...COMMON_TYPES, 'noPotion'] : COMMON_TYPES;
  const hardType = pick(random, hardChoices);
  const otherTypes = COMMON_TYPES.filter((type) => type !== hardType);
  const firstType = pick(random, otherTypes);
  const secondType = otherTypes.find((type) => type !== firstType);
  return [firstType, secondType, hardType];
}

function rewardFor(tier, level) {
  const tierIndex = TIERS.indexOf(tier);
  return {
    gold: Math.round([40, 70, 110][tierIndex] * (1 + level / 5)),
    essence: [2, 4, 6][tierIndex],
    soul: tier === 'hard' ? 1 : 0,
  };
}

function unlockedEnemyKinds(stages) {
  const kinds = new Set();
  for (const stage of stages) {
    for (const room of stage.rooms) {
      for (const wave of room.waves) {
        const enemy = ENEMIES[wave.enemy];
        if (enemy && enemy.behavior !== 'boss-patterns') kinds.add(wave.enemy);
      }
    }
  }
  return [...kinds].sort();
}

function makeContract({ id, index, tier, type, difficulty, random, stages, bossStages, enemyKinds, character }) {
  const target = type === 'kills'
    ? [15, 25, 40][TIERS.indexOf(tier)]
    : type === 'perfect'
      ? [6, 10, 15][TIERS.indexOf(tier)]
      : 1;
  const contract = {
    id,
    index,
    tier,
    type,
    target,
    difficulty,
    rewards: rewardFor(tier, Math.max(1, Number(character?.level) || 1)),
  };
  if (type === 'kills') contract.enemyKind = pick(random, enemyKinds);
  if (type === 'clear') {
    contract.stageId = tier === 'hard'
      ? latestStage(difficulty, character?.clearedStages ?? [])
      : pick(random, stages).id;
  }
  if (type === 'noPotion') contract.stageId = pick(random, bossStages).id;
  return contract;
}

export function dailyContracts(characterId, dateKey, character = {}) {
  const id = String(characterId ?? '');
  if (!id) throw new TypeError('characterId is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) throw new TypeError('Invalid dateKey');
  const difficulty = highestUnlockedDifficulty(character);
  const stages = unlockedStages(character, difficulty);
  const bossStages = stages.filter((stage) => stage.boss);
  const enemyKinds = unlockedEnemyKinds(stages);
  if (!stages.length || !enemyKinds.length) throw new RangeError('No unlocked contract content');
  const random = mulberry32(hashString(`${id}${dateKey}`));
  const types = contractTypes(random, bossStages.length > 0);
  return TIERS.map((tier, index) => makeContract({
    id: `${dateKey}:${index}`,
    index,
    tier,
    type: types[index],
    difficulty,
    random,
    stages,
    bossStages,
    enemyKinds,
    character,
  }));
}

export function contractsFor(character, dateKey) {
  const basis = character?.contracts?.dateKey === dateKey ? character.contracts.basis : null;
  return dailyContracts(character?.id, dateKey, basis ?? character);
}

export function contractDayFirst(character, dateKey, operations) {
  const storedDateKey = character?.contracts?.dateKey;
  if (!storedDateKey || dateKey > storedDateKey) {
    return [{ type: 'contractDay', dateKey }, ...operations];
  }
  if (dateKey === storedDateKey) return operations;
  return operations.filter((operation) => operation.type !== 'contractProgress');
}

export function contractRewards(tier, level) {
  if (!TIERS.includes(tier)) throw new TypeError(`Unknown contract tier: ${tier}`);
  return rewardFor(tier, Math.max(1, Number(level) || 1));
}

export function contractDescription(contract) {
  if (contract.type === 'kills') {
    return `${ENEMY_LABELS[contract.enemyKind] ?? contract.enemyKind} ${contract.target}마리 처치`;
  }
  if (contract.type === 'perfect') return `완벽 회피 ${contract.target}회`;
  if (contract.type === 'clear') {
    return `${STAGES[contract.stageId]?.name ?? contract.stageId} · ${DIFFICULTIES[contract.difficulty]?.label ?? contract.difficulty} 클리어`;
  }
  if (contract.type === 'noPotion') return `${STAGES[contract.stageId]?.name ?? contract.stageId} 보스 물약 없이 처치`;
  return '';
}

export { DAY_MS, TIERS as CONTRACT_TIERS, TIER_LABELS as CONTRACT_TIER_LABELS };
