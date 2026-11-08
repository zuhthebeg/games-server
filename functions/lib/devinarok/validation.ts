import { AFFIXES } from './js/content/affixes.js';
import { ENEMIES } from './js/content/enemies.js';
import {
  FAMILY_STARTER_WEAPONS, ITEMS, LEGENDARIES, RARITIES,
} from './js/content/items.js';
import {
  DIFFICULTIES, effectiveStageLevel, isStageUnlocked, stageClearKey, STAGE_LIST, STAGES,
} from './js/content/stages.js';
import { normalizeCharacter } from './js/save/ops.js';

const HUB_OPS = new Set([
  'createCharacter', 'equip', 'unequip', 'sellItem', 'buyPotion', 'spendGold', 'removeItem', 'updateTutorial',
]);
const SETTLEMENT_OPS = new Set(['gainXp', 'grantGold', 'grantItem', 'clearStage', 'recordClear', 'setPotions']);
const VALID_DIFFICULTIES = ['normal', 'nightmare', 'hell'];
const MAX_ITEMS = 40;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => (
  Number.isSafeInteger(value) && value >= min && value <= max
);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const reject = (message) => { throw new TypeError(message); };

export function settlementCaps(stageId, difficulty, partySize = 1) {
  const stage = STAGES[stageId];
  const tier = DIFFICULTIES[difficulty];
  if (!stage || !tier || !integer(partySize, 1, 4)) reject('invalid-settlement-context');
  let enemyCount = 0;
  let bossCount = 0;
  let baseXp = 0;
  for (const room of stage.rooms) {
    for (const wave of room.waves) {
      const rule = ENEMIES[wave.enemy];
      if (!rule || !integer(wave.count, 1)) reject('invalid-stage-content');
      enemyCount += wave.count;
      baseXp += rule.xp * wave.count;
      if (rule.behavior === 'boss-patterns') bossCount += wave.count;
    }
  }
  const effectiveLevel = effectiveStageLevel(stage, difficulty);
  return {
    enemyCount,
    bossCount,
    baseXp,
    effectiveLevel,
    xpCap: 2 * baseXp * tier.xpMult * 2,
    goldCap: 2 * enemyCount * 5 * effectiveLevel * tier.goldMult * 2,
    itemCap: enemyCount + 2 * bossCount,
    roomCount: stage.rooms.length,
  };
}

function validateGrantedItem(operation, {
  difficulty, bossStage, settlement = false, maxIlvl = 20,
} = {}) {
  const base = ITEMS[operation.itemId];
  if (!base || !integer(operation.ilvl, 1, maxIlvl) || operation.ilvl < base.requiredLevel) reject('invalid-item');
  if (!integer(operation.enhance ?? 0, 0, 10)) reject('invalid-item');
  if (!Object.hasOwn(RARITIES, operation.rarity)) reject('invalid-item');
  if (operation.rarity === 'set' && (
    !settlement || difficulty === 'normal' || !bossStage || !base.setId
  )) reject('invalid-set-item');
  if (operation.legendaryId != null && !LEGENDARIES.some(({ id }) => id === operation.legendaryId)) reject('invalid-legendary');
  if (operation.setId != null && operation.setId !== base.setId) reject('invalid-set-item');
}

export function validateOps({ character, items = [], ops, context, lastSettlementAt = 0, now = Date.now() }) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 128 || !object(context)) reject('invalid-ops');
  if (ops.some((op) => !object(op) || typeof op.type !== 'string')) reject('invalid-ops');

  if (context.kind === 'debug') {
    if (!ops.some((op) => op.type === 'markDebug')) reject('debug-requires-mark');
    return;
  }

  if (context.kind === 'hub') {
    if (ops.some((op) => !HUB_OPS.has(op.type) && op.type !== 'grantItem')) reject('hub-op-not-allowed');
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

  const caps = settlementCaps(stageId, difficulty, partySize);
  let xp = 0;
  let gold = 0;
  let itemCount = 0;
  let clearCount = 0;
  let recordCount = 0;
  let potionCount = 0;
  const expectedKey = stageClearKey(stageId, difficulty);
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
        settlement: true,
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
  const base = ITEMS[item.itemId];
  if (
    !base || (item.characterId && item.characterId !== character.id)
    || !integer(item.ilvl, 1, Math.min(20, character.level + 2))
    || item.ilvl < base.requiredLevel
    || !integer(item.enhance ?? 0, 0, 10)
    || !Object.hasOwn(RARITIES, item.rarity)
    || !Array.isArray(item.affixes ?? [])
    || (item.affixes?.length ?? 0) > (RARITIES[item.rarity]?.affixes ?? 0)
  ) reject('invalid-item');
  const affixes = item.affixes ?? [];
  if (affixes.some((affix) => {
    const rule = AFFIXES[affix?.id];
    return !rule || !Number.isFinite(affix.value) || affix.value < rule.min
      || affix.value > rule.max + rule.perIlvl * item.ilvl;
  })) reject('invalid-item');
  if (item.legendaryId != null && !LEGENDARIES.some(({ id }) => id === item.legendaryId)) reject('invalid-legendary');
  if (item.rarity === 'set' && !base.setId) reject('invalid-set-item');
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
