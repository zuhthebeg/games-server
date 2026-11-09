const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'));

const ROOT = path.join(__dirname, '..');

function bundle(file) {
  const output = esbuild.buildSync({
    entryPoints: [path.join(ROOT, file)],
    bundle: true,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const { AFFIXES } = bundle('functions/lib/devinarok/js/content/affixes.js');
const { ENEMIES } = bundle('functions/lib/devinarok/js/content/enemies.js');
const { ITEM_BASES } = bundle('functions/lib/devinarok/js/content/items.js');
const { DIFFICULTIES, STAGE_LIST, STAGES, effectiveStageLevel, stageClearKey } = bundle('functions/lib/devinarok/js/content/stages.js');
const validators = bundle('functions/lib/devinarok/validation.ts');
const { SKILLS } = bundle('functions/lib/devinarok/js/content/skills.js');
const {
  BUTTONS, COMBO_TIMELINES, createStageWorld, rollStageItem, step,
} = bundle('realtime-poc/src/devinarok/js/sim/world.js');

const SUMMONER_BUDGET = 60;
const BOSS_ADD_BUDGET = 40;

function addXp(enemyIds) {
  return Math.max(0, ...enemyIds.map((enemyId) => ENEMIES[enemyId]?.xp ?? 0));
}

function summonerAddXp(rule) {
  return addXp([rule.summon?.enemy ?? 'minion']);
}

function bossAddEnemyIds(rule) {
  return Object.keys(rule.patterns?.['summon-wave']?.enemies ?? { minion: 1 });
}

function calculateStaticMaximum(stage) {
  let enemyCount = 0;
  let bossCount = 0;
  let baseXp = 0;
  let summonerBudget = 0;
  let maxSummonerAddXp = 0;
  let maxBossAddXp = 0;
  for (const room of stage.rooms) {
    for (const wave of room.waves) {
      const rule = ENEMIES[wave.enemy];
      enemyCount += wave.count;
      baseXp += rule.xp * wave.count;
      if (rule.behavior === 'summoner') {
        summonerBudget += SUMMONER_BUDGET * wave.count;
        maxSummonerAddXp = Math.max(maxSummonerAddXp, summonerAddXp(rule));
      }
      if (rule.behavior === 'boss-patterns') {
        bossCount += wave.count;
        const addEnemyIds = bossAddEnemyIds(rule);
        maxBossAddXp = Math.max(maxBossAddXp, addXp(addEnemyIds));
        for (const enemyId of addEnemyIds) {
          const addRule = ENEMIES[enemyId];
          if (addRule?.behavior === 'summoner') {
            summonerBudget += SUMMONER_BUDGET * BOSS_ADD_BUDGET * wave.count;
            maxSummonerAddXp = Math.max(maxSummonerAddXp, summonerAddXp(addRule));
          }
        }
      }
    }
  }
  return {
    enemyCount,
    bossCount,
    baseXp,
    summonerBudget,
    maxSummonerAddXp,
    bossAddBudget: BOSS_ADD_BUDGET,
    maxBossAddXp,
  };
}

function nearestEnemy(world, player) {
  return world.entities
    .filter((entity) => entity.kind === 'enemy' && !entity.dead && !entity.invulnerable)
    .sort((left, right) => (
      Math.hypot(left.x - player.x, left.z - player.z) - Math.hypot(right.x - player.x, right.z - player.z)
    ))[0];
}

function inTelegraph(player, shape) {
  if (!shape) return false;
  if (shape.type === 'circle') return Math.hypot(player.x - shape.originX, player.z - shape.originZ) <= shape.radius + 0.5;
  if (shape.type === 'circles') return shape.circles.some((circle) => (
    Math.hypot(player.x - circle.x, player.z - circle.z) <= circle.radius + 0.5
  ));
  if (shape.type === 'line' || shape.type === 'sector') {
    const dx = player.x - shape.originX;
    const dz = player.z - shape.originZ;
    const distance = Math.hypot(dx, dz);
    if (distance > (shape.length ?? shape.range) + 0.5) return false;
    if (shape.type === 'line') {
      const forward = dx * Math.cos(shape.angle) + dz * Math.sin(shape.angle);
      const side = Math.abs(-dx * Math.sin(shape.angle) + dz * Math.cos(shape.angle));
      return forward >= 0 && side <= shape.width / 2 + 0.5;
    }
    const angle = Math.atan2(dz, dx) - shape.angle;
    return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) <= shape.halfAngle + 0.15;
  }
  return false;
}

function botTick(world, seq) {
  const player = world.entities.find((entity) => entity.kind === 'player');
  const ranged = player.family === 'crossbow' || player.family === 'staff';
  const enemies = world.entities.filter((entity) => entity.kind === 'enemy' && !entity.dead && !entity.invulnerable);
  const imminent = enemies.find((enemy) => (
    enemy.attackPhase === 'windup'
    && enemy.attackRemaining <= 3
    && inTelegraph(player, enemy.attackShape)
  ));
  const target = nearestEnemy(world, player);
  let dx = 0;
  let dz = 0;
  if (imminent) {
    const angle = imminent.attackShape.angle ?? Math.atan2(player.z - imminent.z, player.x - imminent.x);
    dx = -Math.sin(angle);
    dz = Math.cos(angle);
  } else if (target) {
    dx = target.x - player.x;
    dz = target.z - player.z;
    const length = Math.hypot(dx, dz) || 1;
    if (ranged && length < 5.5) {
      dx = -dx;
      dz = -dz;
    } else if (ranged && length <= 6.5) {
      dx = 0;
      dz = 0;
    } else if (length < 1.1) {
      dx = 0;
      dz = 0;
    }
  } else if (world.roomCleared) {
    const door = world.arena.doors.find((entry) => entry.fromRoom === world.arena.rooms[world.roomIndex]?.id);
    if (door) {
      dx = door.x - player.x;
      dz = door.z - player.z;
    }
  }
  const magnitude = Math.hypot(dx, dz) || 1;
  let moveX = Math.round(dx / magnitude * 127);
  let moveZ = Math.round(dz / magnitude * 127);
  const targetDistance = target ? Math.hypot(target.x - player.x, target.z - player.z) : Infinity;
  if (!ranged && !imminent && target && targetDistance < 1.1) {
    moveX = Math.round((target.x - player.x) / targetDistance * 16);
    moveZ = Math.round((target.z - player.z) / targetDistance * 16);
  }
  let buttons = 0;
  if (imminent && player.dodgeCooldownTicks === 0 && !(player.previousButtons & BUTTONS.DODGE)) buttons |= BUTTONS.DODGE;
  else if (player.hp < player.maxHp * 0.58 && player.potions > 0 && player.potionCooldownTicks === 0) buttons |= BUTTONS.POTION;
  else if (ranged && target && !player.skillCast) {
    const availableSkill = [1, 2, 3].find((id) => (player.skillCooldowns?.[id] ?? 0) === 0);
    if (availableSkill) buttons |= [BUTTONS.SKILL1, BUTTONS.SKILL2, BUTTONS.SKILL3][availableSkill - 1];
    else if (!player.attack) buttons |= BUTTONS.ATTACK;
  } else if (!ranged && player.attack) {
    const timeline = COMBO_TIMELINES[player.attack.step - 1];
    if (player.attack.phase === 'recovery' && player.attack.phaseTick >= timeline.recoveryTicks - timeline.chainWindowTicks) {
      buttons |= BUTTONS.ATTACK;
    }
  } else if (!ranged && target) buttons |= BUTTONS.ATTACK;
  if (!imminent && player.counterReadyTicks > 0) {
    if (player.previousButtons & BUTTONS.ATTACK) buttons &= ~BUTTONS.ATTACK;
    else buttons |= BUTTONS.ATTACK;
  }
  const aimDx = target ? target.x - player.x : dx;
  const aimDz = target ? target.z - player.z : dz;
  const aim = Math.round((Math.atan2(aimDz, aimDx) / (Math.PI * 2) * 256 + 256) % 256);
  return { seq, moveX, moveZ, aim, buttons };
}

function maxAffixGear(family) {
  const bestBase = (slot) => ITEM_BASES
    .filter((base) => base.slot === slot && base.requiredLevel <= 20 && !base.setId)
    .filter((base) => slot !== 'weapon' || base.family === family)
    .sort((left, right) => left.requiredLevel - right.requiredLevel || left.value - right.value)
    .at(-1);
  const affixes = [
    { id: 'goldGain', value: AFFIXES.goldGain.max + AFFIXES.goldGain.perIlvl * 20 },
    { id: 'xpGain', value: AFFIXES.xpGain.max + AFFIXES.xpGain.perIlvl * 20 },
    { id: 'attackPercent', value: AFFIXES.attackPercent.max + AFFIXES.attackPercent.perIlvl * 20 },
  ];
  return ['weapon', 'head', 'body', 'hands', 'feet'].map((slot) => ({
    itemId: bestBase(slot).id,
    rarity: 'legendary',
    ilvl: 20,
    enhance: 10,
    affixes,
  }));
}

function runBossBot({ seed, stageId, difficulty, family }) {
  const playerId = 'settlement-bot';
  const equipment = maxAffixGear(family);
  const world = createStageWorld({
    seed,
    stageId,
    difficulty,
    playerId,
    character: {
      level: 20,
      potions: 5,
      equipment,
      mastery: Object.fromEntries(Object.keys(SKILLS).map((skill) => [skill, 300])),
    },
  });
  const player = world.entities.find((entity) => entity.kind === 'player');
  assert.equal(player.stats.goldGain, 125);
  assert.equal(player.stats.xpGain, 125);
  for (let tick = 1; tick <= 18000 && !world.outcome; tick += 1) {
    step(world, { [playerId]: botTick(world, tick) });
  }
  return world;
}

test('settlement caps cover every stage and tier including maximum summon rewards', () => {
  const goldGain = 1 + (5 * (AFFIXES.goldGain.max + AFFIXES.goldGain.perIlvl * 20)) / 100;
  const xpGain = 1 + (5 * (AFFIXES.xpGain.max + AFFIXES.xpGain.perIlvl * 20)) / 100;
  for (const stage of STAGE_LIST) {
    const maximum = calculateStaticMaximum(stage);
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      const tier = DIFFICULTIES[difficulty];
      const caps = validators.settlementCaps(stage.id, difficulty);
      const effectiveLevel = effectiveStageLevel(stage, difficulty);
      const staticXp = maximum.baseXp * tier.xpMult * xpGain;
      const summonXp = 0.25 * maximum.maxSummonerAddXp * maximum.summonerBudget * tier.xpMult * xpGain;
      const bossAddXp = maximum.maxBossAddXp * maximum.bossAddBudget * maximum.bossCount * tier.xpMult * xpGain;
      const staticGold = 5 * effectiveLevel * tier.goldMult * goldGain * maximum.enemyCount;
      const summonGold = 5 * effectiveLevel * tier.goldMult * goldGain * 0.25 * maximum.summonerBudget;
      const bossAddGold = 5 * effectiveLevel * tier.goldMult * goldGain
        * maximum.bossAddBudget * maximum.bossCount;

      assert.equal(caps.enemyCount, maximum.enemyCount, `${difficulty}:${stage.id} enemy count`);
      assert.equal(caps.summonerBudget, maximum.summonerBudget, `${difficulty}:${stage.id} summoner budget`);
      assert.equal(caps.maxSummonerAddXp, maximum.maxSummonerAddXp, `${difficulty}:${stage.id} summoner XP`);
      assert.equal(caps.bossAddBudget, maximum.bossAddBudget, `${difficulty}:${stage.id} boss-add budget`);
      assert.equal(caps.maxBossAddXp, maximum.maxBossAddXp, `${difficulty}:${stage.id} boss-add XP`);
      assert.equal(caps.xpCap, Math.ceil((staticXp + summonXp + bossAddXp) * 1.25), `${difficulty}:${stage.id} XP formula`);
      assert.equal(caps.goldCap, Math.ceil((staticGold + summonGold + bossAddGold) * 1.25), `${difficulty}:${stage.id} gold formula`);
      assert.equal(caps.itemCap, maximum.enemyCount + 2 * maximum.bossCount + 20 * maximum.bossCount);
      assert.ok(caps.xpCap >= staticXp + summonXp + bossAddXp, `${difficulty}:${stage.id} XP maximum`);
      assert.ok(caps.goldCap >= staticGold + summonGold + bossAddGold, `${difficulty}:${stage.id} gold maximum`);
      assert.deepEqual(
        validators.settlementCaps(stage.id, difficulty, 4),
        caps,
        `${difficulty}:${stage.id} party caps`,
      );
    }
  }

  for (const stageId of ['CB', 'FB', 'KB']) {
    const solo = createStageWorld({ stageId, playerId: 'solo', character: { level: 20 } });
    const party = createStageWorld({
      stageId,
      party: ['one', 'two', 'three', 'four'].map((playerId) => ({
        playerId,
        character: { level: 20 },
      })),
    });
    assert.equal(party.roomEnemyIds.length, solo.roomEnemyIds.length, `${stageId} party enemy count`);
  }
});

test('mastery-max boss bot settlements pass validateOps for every tier and family', { timeout: 600000 }, () => {
  const clearedStages = Object.keys(DIFFICULTIES).flatMap((difficulty) => (
    STAGE_LIST.map((stage) => stageClearKey(stage.id, difficulty))
  ));
  const summaries = [];
  let seed = 4000;
  for (const stageId of ['KB', 'FB', 'CB']) {
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      for (const family of ['sword', 'crossbow', 'staff']) {
        const world = runBossBot({ seed: seed += 1, stageId, difficulty, family });
        assert.equal(world.outcome, 'clear', `${difficulty}:${stageId}:${family} must clear`);
        const result = world.result;
        const stageKey = stageClearKey(stageId, difficulty);
        const ops = [
          { type: 'gainXp', amount: result.xp },
          { type: 'grantGold', amount: result.gold },
          { type: 'setPotions', count: result.potions },
          ...result.items.map((item) => ({
            type: 'grantItem',
            uid: item.uid,
            itemId: item.itemId,
            rarity: item.rarity,
            enhance: item.enhance,
            ilvl: item.ilvl,
            affixes: item.affixes,
            legendaryId: item.legendaryId,
            setId: item.setId,
          })),
          ...Object.entries(result.skillUses ?? {})
            .filter(([, amount]) => amount > 0)
            .map(([skill, amount]) => ({ type: 'gainMastery', skill, amount })),
          { type: 'clearStage', stageId: stageKey },
          { type: 'recordClear', key: stageKey, ticks: result.ticks },
        ];
        const character = {
          id: 'settlement-bot',
          level: 20,
          potions: 5,
          clearedStages,
        };
        const caps = validators.settlementCaps(stageId, difficulty);
        assert.doesNotThrow(() => validators.validateOps({
          character: {
            ...character,
            mastery: Object.fromEntries(Object.keys(SKILLS).map((skill) => [skill, 300])),
          },
          items: [],
          ops,
          context: {
            kind: 'settlement', stageId, difficulty, partySize: 1, outcome: 'clear', ticks: result.ticks,
          },
          lastSettlementAt: 0,
          now: 100000,
        }), `${difficulty}:${stageId}:${family} settlement ${JSON.stringify({
          xp: result.xp,
          xpCap: caps.xpCap,
          gold: result.gold,
          goldCap: caps.goldCap,
          items: result.items.length,
          itemCap: caps.itemCap,
          potions: result.potions,
          ticks: result.ticks,
          minimumTicks: 150 * caps.roomCount,
          bossSummons: world.events.filter((event) => event.type === 'bossSummon'),
          enemies: world.entities
            .filter((entity) => entity.kind === 'enemy')
            .map(({ enemyKind, boss, summoned, summonedBy }) => ({ enemyKind, boss, summoned, summonedBy })),
        })}`);
        summaries.push({
          key: `${difficulty}:${stageId}:${family}`,
          xp: result.xp,
          xpCap: caps.xpCap,
          gold: result.gold,
          goldCap: caps.goldCap,
          items: result.items.length,
          itemCap: caps.itemCap,
        });
      }
    }
  }
  console.log(`M5d max-affix boss settlements: ${JSON.stringify(summaries)}`);
});

test('200 real item rolls at ilvl 1–20 pass import and settlement validation', () => {
  const stageId = 'KB';
  const difficulty = 'hell';
  const clearKey = stageClearKey(stageId, difficulty);
  const clearedStages = Object.keys(DIFFICULTIES)
    .flatMap((tier) => STAGE_LIST.map((stage) => stageClearKey(stage.id, tier)))
    .filter((key) => key !== clearKey);
  const character = {
    id: 'rolled-item-validator',
    name: '검증기사',
    kind: 'knight',
    level: 20,
    xp: 0,
    gold: 0,
    potions: 5,
    rev: 1,
    debugUsed: false,
    equipment: { weapon: null, head: null, body: null, hands: null, feet: null },
    clearedStages,
    records: {},
  };
  const levels = new Set();
  const items = [];
  for (let index = 0; index < 200; index += 1) {
    const ilvl = index % 20 + 1;
    const rarity = ilvl >= 15 && ilvl === 15
      ? 'set'
      : ['common', 'magic', 'rare', 'legendary'][index % 4];
    const world = createStageWorld({
      seed: 8000 + index,
      stageId,
      difficulty,
      playerId: character.id,
      character: { level: 20 },
    });
    const rolled = rollStageItem(world, { stageLevel: ilvl, forcedRarity: rarity });
    const item = {
      uid: `rolled-${index}`,
      characterId: character.id,
      slot: null,
      ...rolled,
    };
    levels.add(item.ilvl);
    items.push(item);
    assert.doesNotThrow(() => validators.validateImport({ character, items: [item] }), `import ${index}: ${JSON.stringify(item)}`);
    assert.doesNotThrow(() => validators.validateOps({
      character,
      items: [],
      ops: [
        { type: 'grantItem', ...item },
        { type: 'clearStage', stageId: clearKey },
      ],
      context: { kind: 'settlement', stageId, difficulty, partySize: 1, outcome: 'clear' },
      lastSettlementAt: 0,
      now: 100000,
    }), `settlement ${index}: ${JSON.stringify(item)}`);
  }
  assert.deepEqual([...levels].sort((left, right) => left - right), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(items.some((item) => item.legendaryId), 'includes real legendary rolls');
  assert.ok(items.some((item) => item.rarity === 'set'), 'includes real set rolls');

  const legendary = items.find((item) => item.legendaryId);
  const forgedLegendary = {
    ...legendary,
    affixes: legendary.affixes.map((affix) => (
      affix.unique === legendary.legendaryId ? { ...affix, value: affix.value + 1 } : affix
    )),
  };
  assert.throws(() => validators.validateImport({ character, items: [forgedLegendary] }), /invalid-legendary/);
  assert.throws(() => validators.validateOps({
    character,
    items: [],
    ops: [
      { type: 'grantItem', ...forgedLegendary },
      { type: 'clearStage', stageId: clearKey },
    ],
    context: { kind: 'settlement', stageId, difficulty, partySize: 1, outcome: 'clear' },
    lastSettlementAt: 0,
    now: 100000,
  }), /invalid-legendary/);
});
