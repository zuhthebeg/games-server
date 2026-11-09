import { AFFIXES } from './js/content/affixes.js';
import { contractsFor, kstDateKey } from './js/content/contracts.js';
import { ENEMIES } from './js/content/enemies.js';
import {
  FAMILY_STARTER_WEAPONS, ITEMS, LEGENDARIES, RARITIES,
} from './js/content/items.js';
import { MASTERY_MAX_XP, MASTERY_MIN_COOLDOWN_TICKS } from './js/content/mastery.js';
import { SKILLS } from './js/content/skills.js';
import {
  DIFFICULTIES, effectiveStageLevel, isStageUnlocked, stageClearKey, STAGE_LIST, STAGES,
} from './js/content/stages.js';
import { normalizeCharacter } from './js/save/ops.js';

const HUB_OPS = new Set([
  'createCharacter', 'equip', 'unequip', 'sellItem', 'buyPotion', 'spendGold', 'removeItem', 'updateTutorial',
  'claimContract', 'salvageItem', 'contractDay',
]);
const SETTLEMENT_OPS = new Set([
  'gainXp', 'gainMastery', 'grantGold', 'grantItem', 'clearStage', 'recordClear', 'setPotions', 'contractProgress', 'contractDay',
]);
const VALID_DIFFICULTIES = ['normal', 'nightmare', 'hell'];
const MAX_ITEMS = 40;
const SUMMONER_BUDGET = 60;
const BOSS_ADD_BUDGET = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => (
  Number.isSafeInteger(value) && value >= min && value <= max
);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const reject = (message) => { throw new TypeError(message); };

export function validateCharacterMaterials(character) {
  if (!object(character)) reject('invalid-character');
  if (character.materials === undefined) return;
  if (
    !object(character.materials)
    || !integer(character.materials.essence, 0, 9999)
    || !integer(character.materials.soul, 0, 9999)
  ) reject('invalid-materials');
}

export function validateCharacterContracts(character) {
  const basis = character?.contracts?.basis;
  if (basis == null) return;
  if (
    !object(basis) || !Array.isArray(basis.clearedStages)
    || !basis.clearedStages.every((stage) => typeof stage === 'string' && character.clearedStages?.includes(stage))
    || !integer(basis.level, 1, character.level)
  ) reject('invalid-contracts');
}

export function validateCharacterMastery(character) {
  const mastery = character?.mastery;
  if (mastery === undefined) return;
  if (
    !object(mastery)
    || Object.entries(mastery).some(([skill, xp]) => !Object.hasOwn(SKILLS, skill) || !integer(xp, 0, MASTERY_MAX_XP))
  ) reject('invalid-mastery');
}

function validateContractDate(dateKey, now) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) reject('invalid-contract-date');
  const today = kstDateKey(now);
  if (dateKey !== today && dateKey !== kstDateKey(now - DAY_MS)) reject('stale-contract-date');
}

function findContract(character, dateKey, contractId, now) {
  validateContractDate(dateKey, now);
  const contract = contractsFor(character, dateKey).find(({ id }) => id === contractId);
  if (!contract) reject('invalid-contract');
  return contract;
}

function addXp(enemyIds) {
  let maxXp = 0;
  for (const enemyId of enemyIds) {
    const rule = ENEMIES[enemyId];
    if (!rule) reject('invalid-stage-content');
    maxXp = Math.max(maxXp, rule.xp);
  }
  return maxXp;
}

function summonerAddXp(rule) {
  return addXp([rule.summon?.enemy ?? 'minion']);
}

function bossAddEnemyIds(rule) {
  return Object.keys(rule.patterns?.['summon-wave']?.enemies ?? { minion: 1 });
}

export function settlementCaps(stageId, difficulty, partySize = 1) {
  const stage = STAGES[stageId];
  const tier = DIFFICULTIES[difficulty];
  if (!stage || !tier || !integer(partySize, 1, 4)) reject('invalid-settlement-context');
  let enemyCount = 0;
  let bossCount = 0;
  let baseXp = 0;
  let summonerBudget = 0;
  let maxSummonerAddXp = 0;
  let maxBossAddXp = 0;
  const enemySpawnCaps = {};
  const addSpawnCap = (enemyId, count) => {
    enemySpawnCaps[enemyId] = (enemySpawnCaps[enemyId] ?? 0) + count;
  };
  for (const room of stage.rooms) {
    for (const wave of room.waves) {
      const rule = ENEMIES[wave.enemy];
      if (!rule || !integer(wave.count, 1)) reject('invalid-stage-content');
      enemyCount += wave.count;
      baseXp += rule.xp * wave.count;
      addSpawnCap(wave.enemy, wave.count);
      if (rule.behavior === 'summoner') {
        summonerBudget += SUMMONER_BUDGET * wave.count;
        maxSummonerAddXp = Math.max(maxSummonerAddXp, summonerAddXp(rule));
        addSpawnCap(rule.summon?.enemy ?? 'minion', SUMMONER_BUDGET * wave.count);
      }
      if (rule.behavior === 'boss-patterns') {
        bossCount += wave.count;
        const addEnemyIds = bossAddEnemyIds(rule);
        maxBossAddXp = Math.max(maxBossAddXp, addXp(addEnemyIds));
        for (const enemyId of addEnemyIds) addSpawnCap(enemyId, BOSS_ADD_BUDGET * wave.count);
        for (const enemyId of addEnemyIds) {
          const addRule = ENEMIES[enemyId];
          if (addRule.behavior === 'summoner') {
            summonerBudget += SUMMONER_BUDGET * BOSS_ADD_BUDGET * wave.count;
            maxSummonerAddXp = Math.max(maxSummonerAddXp, summonerAddXp(addRule));
            addSpawnCap(
              addRule.summon?.enemy ?? 'minion',
              SUMMONER_BUDGET * BOSS_ADD_BUDGET * wave.count,
            );
          }
        }
      }
    }
  }
  const effectiveLevel = effectiveStageLevel(stage, difficulty);
  const maxGoldGain = 5 * (AFFIXES.goldGain.max + AFFIXES.goldGain.perIlvl * 20);
  const maxXpGain = 5 * (AFFIXES.xpGain.max + AFFIXES.xpGain.perIlvl * 20);
  const goldGainMultiplier = 1 + maxGoldGain / 100;
  const xpGainMultiplier = 1 + maxXpGain / 100;
  const perEnemyGoldMax = 5 * effectiveLevel * tier.goldMult;
  return {
    enemyCount,
    bossCount,
    baseXp,
    effectiveLevel,
    summonerBudget,
    enemySpawnCaps,
    maxSummonerAddXp,
    bossAddBudget: BOSS_ADD_BUDGET,
    maxBossAddXp,
    xpCap: Math.ceil((
      baseXp
      + 0.25 * maxSummonerAddXp * summonerBudget
      + maxBossAddXp * BOSS_ADD_BUDGET * bossCount
    ) * tier.xpMult * xpGainMultiplier * 1.25),
    goldCap: Math.ceil(perEnemyGoldMax * goldGainMultiplier * (
      enemyCount + 0.25 * summonerBudget + BOSS_ADD_BUDGET * bossCount
    ) * 1.25),
    itemCap: enemyCount + 2 * bossCount + 20 * bossCount,
    roomCount: stage.rooms.length,
  };
}

function validateItemFields(item, {
  characterId, maxIlvl = 20, settlement = false,
} = {}) {
  const base = ITEMS[item.itemId];
  if (
    !base || (characterId && item.characterId && item.characterId !== characterId)
    || !integer(item.ilvl, 1, maxIlvl) || item.ilvl < base.requiredLevel
    || !integer(item.enhance ?? 0, 0, 10)
    || !Object.hasOwn(RARITIES, item.rarity)
    || !Array.isArray(item.affixes ?? [])
  ) reject('invalid-item');
  const affixes = item.affixes ?? [];
  const legendary = item.legendaryId == null
    ? null
    : LEGENDARIES.find(({ id }) => id === item.legendaryId);
  if (item.legendaryId != null && !legendary) reject('invalid-legendary');
  const uniqueAffixes = affixes.filter((affix) => affix?.unique != null);
  if (uniqueAffixes.length !== Number(Boolean(legendary))) reject('invalid-legendary');
  if (legendary) {
    const uniqueAffix = uniqueAffixes[0];
    if (
      uniqueAffix.unique !== legendary.id
      || uniqueAffix.id !== legendary.stat
      || uniqueAffix.value !== legendary.value
    ) reject('invalid-legendary');
  }
  if (affixes.length - uniqueAffixes.length > RARITIES[item.rarity].affixes) reject('invalid-item');
  if (settlement && (item.enhance ?? 0) !== 0) reject('invalid-item');
  if (settlement && Object.hasOwn(item, 'slot') && item.slot !== null) reject('invalid-item');
  if (affixes.some((affix) => {
    if (item.legendaryId != null && affix?.unique === item.legendaryId) return false;
    const rule = AFFIXES[affix?.id];
    const min = rule && Math.round(rule.min + rule.perIlvl * item.ilvl) - 1;
    const max = rule && Math.round(rule.max + rule.perIlvl * item.ilvl);
    return !rule || !Number.isFinite(affix.value) || affix.value < min || affix.value > max;
  })) reject('invalid-item');
  if (item.rarity === 'set' && !base.setId) reject('invalid-set-item');
  if (item.setId != null && item.setId !== base.setId) reject('invalid-set-item');
  return base;
}

function validateGrantedItem(operation, { difficulty, bossStage, maxIlvl = 20 } = {}) {
  const base = validateItemFields(operation, { maxIlvl, settlement: true });
  if (operation.rarity === 'set' && (difficulty === 'normal' || !bossStage || !base.setId)) {
    reject('invalid-set-item');
  }
}

export function validateOps({ character, items = [], ops, context, lastSettlementAt = 0, now = Date.now() }) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 128 || !object(context)) reject('invalid-ops');
  if (ops.some((op) => !object(op) || typeof op.type !== 'string')) reject('invalid-ops');
  if (ops.some((op) => op.type === 'reforgeAffix')) reject('online-reforge-required');

  if (context.kind === 'debug') {
    if (ops.some((op) => ['claimContract', 'contractProgress', 'gainMastery'].includes(op.type))) reject('invalid-contract-context');
    if (!ops.some((op) => op.type === 'markDebug')) reject('debug-requires-mark');
    return;
  }

  if (context.kind === 'hub') {
    if (ops.some((op) => !HUB_OPS.has(op.type) && op.type !== 'grantItem')) reject('hub-op-not-allowed');
    for (const op of ops.filter(({ type }) => type === 'contractDay')) validateContractDate(op.dateKey, now);
    for (const op of ops.filter(({ type }) => type === 'claimContract')) {
      if (!character) reject('invalid-character');
      findContract(character, op.dateKey, op.contractId, now);
    }
    if (ops.some((op) => op.type === 'grantItem')) {
      const grants = ops.filter((op) => op.type === 'grantItem');
      const costs = ops.filter((op) => op.type === 'spendGold');
      if (grants.length !== 1 || costs.length !== 1) reject('starter-weapon-purchase-invalid');
      const starter = FAMILY_STARTER_WEAPONS.find(({ itemId }) => itemId === grants[0].itemId);
      if (
        !starter || costs[0].amount !== starter.price || grants[0].rarity !== 'common'
        || grants[0].ilvl !== 1 || (grants[0].enhance ?? 0) !== 0
        || !Array.isArray(grants[0].affixes ?? []) || (grants[0].affixes?.length ?? 0) !== 0
        || grants[0].legendaryId != null || grants[0].setId != null
      ) reject('starter-weapon-purchase-invalid');
    }
    if (ops.some((op) => op.type === 'createCharacter') && (character || ops.length !== 1)) reject('invalid-character-create');
    return;
  }

  if (context.kind !== 'settlement') reject('invalid-context');
  const { stageId, difficulty, partySize = 1, outcome } = context;
  const stage = STAGES[stageId];
  if (!stage || !DIFFICULTIES[difficulty] || !integer(partySize, 1, 4) || !['clear', 'death', 'retreat'].includes(outcome)) {
    reject('invalid-settlement-context');
  }
  if (!character || !isStageUnlocked(stageId, character.clearedStages ?? [], difficulty)) reject('stage-locked');
  if (now - lastSettlementAt < 10000) reject('settlement-rate-limit');
  if (ops.some((op) => !SETTLEMENT_OPS.has(op.type))) reject('settlement-op-not-allowed');
  for (const op of ops.filter(({ type }) => type === 'contractDay')) validateContractDate(op.dateKey, now);

  const caps = settlementCaps(stageId, difficulty, partySize);
  let xp = 0;
  let gold = 0;
  let itemCount = 0;
  let clearCount = 0;
  let recordCount = 0;
  let potionCount = 0;
  const contractProgress = new Map();
  const masteryGains = new Set();
  const expectedKey = stageClearKey(stageId, difficulty);
  const recordTicks = ops.find((op) => op.type === 'recordClear')?.ticks;
  const settlementTicks = integer(context.ticks) ? context.ticks : recordTicks;
  const perfectCap = Number.isSafeInteger(settlementTicks)
    ? Math.min(Math.floor(settlementTicks / 30), 60)
    : 0;
  for (const op of ops) {
    if (op.type === 'gainXp') {
      if (!integer(op.amount)) reject('invalid-xp');
      xp += op.amount;
    } else if (op.type === 'grantGold') {
      if (!integer(op.amount)) reject('invalid-gold');
      gold += op.amount;
    } else if (op.type === 'grantItem') {
      itemCount += 1;
      if (outcome !== 'clear') reject('items-require-clear');
      validateGrantedItem(op, {
        difficulty,
        bossStage: stage.boss,
        maxIlvl: Math.min(20, caps.effectiveLevel + 2),
      });
    } else if (op.type === 'clearStage') {
      clearCount += 1;
      if (outcome !== 'clear' || op.stageId !== expectedKey) reject('invalid-stage-clear');
    } else if (op.type === 'recordClear') {
      recordCount += 1;
      if (
        outcome !== 'clear' || op.key !== expectedKey
        || !integer(op.ticks, 150 * caps.roomCount)
      ) reject('invalid-stage-record');
    } else if (op.type === 'setPotions') {
      potionCount += 1;
      if (!integer(op.count, 0, character.potions) || op.count > 5) reject('invalid-potions');
    } else if (op.type === 'gainMastery') {
      if (!Object.hasOwn(SKILLS, op.skill) || !integer(op.amount, 1)) reject('invalid-mastery');
      if (masteryGains.has(op.skill)) reject('duplicate-mastery-gain');
      masteryGains.add(op.skill);
      const cooldownTicks = MASTERY_MIN_COOLDOWN_TICKS(op.skill);
      const masteryCap = Math.min(60, Math.floor((settlementTicks ?? 0) / cooldownTicks) + 1);
      if (op.amount > masteryCap) reject('mastery-cap-exceeded');
    } else if (op.type === 'contractProgress') {
      const contract = findContract(character, op.dateKey, op.contractId, now);
      if (!integer(op.amount, 1)) reject('invalid-contract-progress');
      let cap = 0;
      if (contract.type === 'kills') {
        cap = caps.enemySpawnCaps[contract.enemyKind] ?? 0;
      } else if (contract.type === 'perfect') {
        cap = perfectCap;
      } else if (
        outcome === 'clear'
        && contract.stageId === stageId
        && contract.difficulty === difficulty
        && (contract.type !== 'noPotion' || context.potionsUsed === 0)
      ) {
        cap = 1;
      }
      const stored = character.contracts?.dateKey === op.dateKey ? character.contracts.progress : {};
      const remaining = Math.max(0, contract.target - (stored?.[contract.id] ?? 0));
      const total = (contractProgress.get(contract.id) ?? 0) + op.amount;
      if (total > Math.min(cap, remaining)) reject('contract-progress-cap-exceeded');
      contractProgress.set(contract.id, total);
    }
  }
  if (
    xp > caps.xpCap || gold > caps.goldCap || itemCount > caps.itemCap
    || clearCount !== (outcome === 'clear' ? 1 : 0)
    || recordCount > 1 || potionCount > 1
  ) reject('settlement-cap-exceeded');
}

function validateItem(item, character, seen) {
  if (!object(item) || typeof item.uid !== 'string' || !item.uid || seen.has(item.uid)) reject('invalid-item');
  const base = validateItemFields(item, {
    characterId: character.id,
    maxIlvl: Math.min(20, character.level + 2),
  });
  seen.add(item.uid);
  return {
    ...item,
    characterId: character.id,
    requiredLevel: base.requiredLevel,
    ...(base.setId ? { setId: base.setId } : { setId: undefined }),
  };
}

function validateClearChain(clearedStages) {
  if (!Array.isArray(clearedStages) || clearedStages.some((key) => typeof key !== 'string')) reject('invalid-clears');
  const clearSet = new Set(clearedStages);
  if (clearSet.size !== clearedStages.length) reject('invalid-clears');
  const validKeys = new Set(VALID_DIFFICULTIES.flatMap((difficulty) => (
    STAGE_LIST.map((stage) => stageClearKey(stage.id, difficulty))
  )));
  if ([...clearSet].some((key) => !validKeys.has(key))) reject('invalid-clears');
  const unlocked = [];
  for (const difficulty of VALID_DIFFICULTIES) {
    for (const stage of STAGE_LIST) {
      const key = stageClearKey(stage.id, difficulty);
      if (!clearSet.has(key)) continue;
      if (!isStageUnlocked(stage.id, unlocked, difficulty)) reject('invalid-clear-chain');
      unlocked.push(key);
    }
  }
}

export function validateImport(snapshot) {
  if (!object(snapshot) || !object(snapshot.character) || !Array.isArray(snapshot.items)) reject('invalid-snapshot');
  validateCharacterMaterials(snapshot.character);
  validateCharacterContracts(snapshot.character);
  validateCharacterMastery(snapshot.character);
  const character = normalizeCharacter(snapshot.character);
  delete character.cloudUserId;
  if (
    typeof character.id !== 'string' || !character.id
    || typeof character.name !== 'string' || character.name.trim() !== character.name
    || [...character.name].length < 1 || [...character.name].length > 12
    || character.kind !== 'knight'
    || !integer(character.level, 1, 20)
    || !integer(character.xp)
    || !integer(character.gold, 0, 50000 * character.level)
    || !integer(character.potions, 0, 5)
    || !integer(character.rev, 1)
    || !object(character.equipment)
    || !object(character.records)
    || typeof character.debugUsed !== 'boolean'
  ) reject('invalid-snapshot');
  const xpFloor = character.level >= 20 ? 0 : Math.round(60 * character.level ** 1.6);
  if ((character.level >= 20 && character.xp !== 0) || (character.level < 20 && character.xp >= xpFloor)) {
    reject('invalid-level-xp');
  }
  validateClearChain(character.clearedStages);
  const seen = new Set();
  const items = snapshot.items.map((item) => validateItem(item, character, seen));
  if (items.length > MAX_ITEMS) reject('invalid-items');
  const byUid = new Map(items.map((item) => [item.uid, item]));
  const slots = ['weapon', 'head', 'body', 'hands', 'feet'];
  if (slots.some((slot) => {
    const uid = character.equipment[slot];
    if (uid == null) return false;
    const item = byUid.get(uid);
    return !item || item.slot !== slot || ITEMS[item.itemId]?.slot !== slot || item.requiredLevel > character.level;
  })) reject('invalid-equipment');
  if (items.some((item) => item.slot && character.equipment[item.slot] !== item.uid)) reject('invalid-equipment');
  for (const [key, ticks] of Object.entries(character.records)) {
    const match = VALID_DIFFICULTIES.flatMap((difficulty) => (
      STAGE_LIST.map((stage) => ({ key: stageClearKey(stage.id, difficulty), stage }))
    )).find((record) => record.key === key);
    if (!match || !character.clearedStages.includes(key) || !integer(ticks, 150 * match.stage.rooms.length)) {
      reject('invalid-records');
    }
  }
  return { character, items };
}
