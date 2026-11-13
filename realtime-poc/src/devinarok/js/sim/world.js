import { ARENA } from './arena.js';
import { AFFIXES } from '../content/affixes.js';
import { rollAffixValue } from '../content/affix-value.js';
import { ENEMIES } from '../content/enemies.js';
import {
  equipmentLook,
  ITEM_BASES,
  ITEMS,
  ITEM_SETS,
  LEGENDARIES,
  RARITIES,
  BOSS_RARITIES,
  BOSS_RARITIES_HELL,
  BOSS_RARITIES_NIGHTMARE,
  ELITE_RARITIES,
} from '../content/items.js';
import { POTION, POTION_DROP, SKILLS, skillsFor } from '../content/skills.js';
import { masteryBonus, masteryRank } from '../content/mastery.js';
import {
  isEvolved, isSkeletonLineage, lineageOf, playerFamily,
} from '../content/lineages.js';
import { normalizedTalents, TALENTS } from '../content/talents.js';
import { objectiveBonusGold } from '../content/objectives.js';
import { DIFFICULTIES, effectiveStageLevel, STAGES } from '../content/stages.js';
import { HUB_ARENA } from '../content/stages.js';

export const TICK_HZ = 30;
export const PERFECT_DODGE_TICKS = 5;
export const PARTY_PERFECT_DODGE_TICKS = 7;
const WARD_TARGET_ID = -1;
export const BUTTONS = {
  ATTACK: 1,
  DODGE: 2,
  SKILL1: 4,
  SKILL2: 8,
  SKILL3: 16,
  SKILL4: 128,
  INTERACT: 32,
  POTION: 64,
};

export const COMBO_TIMELINES = [
  { windupTicks: 6, activeTicks: 4, recoveryTicks: 9, chainWindowTicks: 5, range: 1.65, halfAngle: 0.78, damage: 1, knockback: 0.3 },
  { windupTicks: 6, activeTicks: 4, recoveryTicks: 10, chainWindowTicks: 5, range: 1.8, halfAngle: 0.9, damage: 1, knockback: 0.38 },
  { windupTicks: 8, activeTicks: 5, recoveryTicks: 12, chainWindowTicks: 6, range: 2.05, halfAngle: 1.12, damage: 2, knockback: 0.62 },
];

const MAX_EVENTS = 128;
const PLAYER_SPEED = 4.5;
const PLAYER_RADIUS = 0.32;
const PLAYER_MAX_HP = 100;
const DODGE_DURATION_TICKS = 9;
const DODGE_IFRAME_TICKS = 8;
export const DODGE_COOLDOWN_TICKS = 36;
const PLAYER_RESPAWN_TICKS = 90;

const ENEMY_RULES = {
  Skeleton_Minion: {
    maxHp: 3,
    radius: 0.38,
    speed: 1.65,
    attackRange: 1.42,
    attackWindupTicks: 15,
    attackDurationTicks: 3,
    attackCooldownTicks: 30,
    attackHalfAngle: 0.68,
    damage: 12,
  },
  Skeleton_Warrior: {
    maxHp: 6,
    radius: 0.48,
    speed: 1.05,
    attackRange: 1.9,
    attackWindupTicks: 21,
    attackDurationTicks: 4,
    attackCooldownTicks: 40,
    attackHalfAngle: 0.82,
    damage: 18,
  },
};

function copyArena(arena) {
  const spawnPoints = arena.spawnPoints ?? [];
  return {
    id: arena.id,
    name: arena.name ?? arena.id ?? '시험의 방',
    region: arena.region ?? 1,
    ...(arena.theme ? { theme: arena.theme } : {}),
    stageLevel: arena.stageLevel ?? 1,
    recommendedLevel: arena.recommendedLevel ?? 1,
    boss: Boolean(arena.boss),
    width: arena.width,
    depth: arena.depth,
    bounds: { ...arena.bounds },
    playerSpawn: { ...arena.playerSpawn },
    spawnPoints: Array.isArray(spawnPoints[0])
      ? spawnPoints.map((room) => room.map((point) => ({ ...point })))
      : spawnPoints.map((point) => ({ ...point })),
    obstacles: arena.obstacles.map((obstacle) => ({ ...obstacle })),
    props: (arena.props ?? []).map((prop) => ({ ...prop })),
    doors: (arena.doors ?? []).map((door) => ({ ...door })),
    rooms: (arena.rooms ?? []).map((room) => ({
      ...room,
      waves: room.waves.map((wave) => ({ ...wave })),
      ...(room.objective ? {
        objective: {
          ...room.objective,
          ...(room.objective.spawns ? { spawns: room.objective.spawns.map((spawn) => ({ ...spawn })) } : {}),
        },
      } : {}),
    })),
  };
}

function random(world, stateKey = 'rngState') {
  world[stateKey] = ((world[stateKey] ?? world.rngState) + 0x6d2b79f5) >>> 0;
  let value = world[stateKey];
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function emit(world, type, data = {}) {
  const event = {
    eventId: world.nextEventId,
    tick: world.tick,
    type,
    ...data,
  };
  world.nextEventId += 1;
  world.events.push(event);
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
  return event;
}

function nextEntityId(world) {
  const id = world.nextEntityId;
  world.nextEntityId += 1;
  return id;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInput(value, min, max, fallback = 0) {
  return Number.isFinite(value) ? clamp(Math.trunc(value), min, max) : fallback;
}

function normalizeInput(player, rawInput) {
  const previous = player.lastInput;
  if (!rawInput) {
    return {
      seq: previous.seq,
      moveX: previous.moveX,
      moveZ: previous.moveZ,
      aim: previous.aim,
      buttons: 0,
    };
  }
  return {
    seq: clampInput(rawInput.seq, 0, 2147483647, previous.seq + 1),
    moveX: clampInput(rawInput.moveX, -127, 127, previous.moveX),
    moveZ: clampInput(rawInput.moveZ, -127, 127, previous.moveZ),
    aim: clampInput(rawInput.aim, 0, 255, previous.aim),
    buttons: clampInput(rawInput.buttons, 0, 255, 0),
    ...(Number.isFinite(rawInput.ad) && player.family !== 'sword'
      ? {
        ad: Math.round(clamp(
          rawInput.ad,
          0,
          player.family === 'crossbow' ? 12 : 8,
        ) * 10) / 10,
      }
      : {}),
    ...(Number.isSafeInteger(rawInput.viewTick) ? { viewTick: rawInput.viewTick } : {}),
  };
}

function angleFromAim(aim) {
  return (aim / 256) * Math.PI * 2;
}

function clampToArena(world, entity) {
  const bounds = world.arena.bounds;
  entity.x = clamp(entity.x, bounds.minX + entity.radius, bounds.maxX - entity.radius);
  entity.z = clamp(entity.z, bounds.minZ + entity.radius, bounds.maxZ - entity.radius);
}

function resolveObstacle(entity, obstacle, startX, startZ, movementX, movementZ) {
  if (obstacle.type === 'circle') {
    const dx = entity.x - obstacle.x;
    const dz = entity.z - obstacle.z;
    const minimum = entity.radius + obstacle.radius;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= minimum * minimum) return;
    const distance = Math.sqrt(distanceSquared) || 0.0001;
    const overlap = minimum - distance;
    entity.x += (dx / distance) * overlap;
    entity.z += (dz / distance) * overlap;
    return;
  }

  if (obstacle.type !== 'rect') return;
  const halfWidth = obstacle.width / 2;
  const halfDepth = obstacle.depth / 2;
  const closestX = clamp(entity.x, obstacle.x - halfWidth, obstacle.x + halfWidth);
  const closestZ = clamp(entity.z, obstacle.z - halfDepth, obstacle.z + halfDepth);
  let dx = entity.x - closestX;
  let dz = entity.z - closestZ;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= entity.radius * entity.radius) return;
  if (distanceSquared > 0) {
    const distance = Math.sqrt(distanceSquared);
    const overlap = entity.radius - distance;
    entity.x += (dx / distance) * overlap;
    entity.z += (dz / distance) * overlap;
    return;
  }

  const penetrationX = halfWidth + entity.radius - Math.abs(entity.x - obstacle.x);
  const penetrationZ = halfDepth + entity.radius - Math.abs(entity.z - obstacle.z);
  if (penetrationX < penetrationZ) {
    dx = entity.x < obstacle.x
      ? -1
      : entity.x > obstacle.x
        ? 1
        : startX < obstacle.x || (startX === obstacle.x && movementX > 0) ? -1 : 1;
    entity.x += dx * penetrationX;
  } else {
    dz = entity.z < obstacle.z
      ? -1
      : entity.z > obstacle.z
        ? 1
        : startZ < obstacle.z || (startZ === obstacle.z && movementZ > 0) ? -1 : 1;
    entity.z += dz * penetrationZ;
  }
}

function moveEntity(world, entity, dx, dz) {
  const startX = entity.x;
  const startZ = entity.z;
  entity.x += dx;
  entity.z += dz;
  for (let pass = 0; pass < 2; pass += 1) {
    clampToArena(world, entity);
    for (const obstacle of world.arena.obstacles) {
      if (obstacle.doorId && world.openDoors?.[obstacle.doorId]) continue;
      resolveObstacle(entity, obstacle, startX, startZ, dx, dz);
    }
  }
  clampToArena(world, entity);
}

function angleDifference(a, b) {
  let difference = (a - b) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

function inSector(shape, target, targetRadius = 0) {
  const dx = target.x - shape.originX;
  const dz = target.z - shape.originZ;
  const distance = Math.hypot(dx, dz);
  if (distance > shape.range + targetRadius || distance < 0.0001) return false;
  const targetAngle = Math.atan2(dz, dx);
  return Math.abs(angleDifference(targetAngle, shape.angle)) <= shape.halfAngle;
}

function createAttackShape(entity, angle, range, halfAngle) {
  return {
    type: 'sector',
    originX: entity.x,
    originZ: entity.z,
    angle,
    range,
    halfAngle,
  };
}

function copyShape(shape) {
  return {
    ...shape,
    ...(shape.circles ? { circles: shape.circles.map((circle) => ({ ...circle })) } : {}),
  };
}

function activeEnemies(world) {
  return world.entities.filter((entity) => entity.kind === 'enemy' && !entity.dead);
}

function activePlayers(world) {
  return world.entities.filter((entity) => (
    entity.kind === 'player' && !entity.dead && !entity.downed && entity.connected !== false
  ));
}

function stagePlayers(world) {
  return world.players
    .map((entityId) => world.entities.find((entity) => entity.id === entityId))
    .filter((entity) => entity?.kind === 'player')
    .sort((a, b) => a.id - b.id);
}

function chooseSpawnPoint(world) {
  const points = world.arena.spawnPoints;
  return points[Math.floor(random(world) * points.length)];
}

export function spawnEnemy(world, enemyKind = 'Skeleton_Minion', position = null) {
  const kind = Object.hasOwn(ENEMY_RULES, enemyKind) ? enemyKind : 'Skeleton_Minion';
  const rules = ENEMY_RULES[kind];
  const point = position ?? chooseSpawnPoint(world);
  const enemy = {
    id: nextEntityId(world),
    kind: 'enemy',
    enemyKind: kind,
    x: point.x,
    z: point.z,
    facing: Math.PI / 2,
    radius: rules.radius,
    hp: rules.maxHp,
    maxHp: rules.maxHp,
    dead: false,
    deathTicks: 0,
    spawnTicksLeft: 30,
    invulnerable: true,
    hitFlashTicks: 0,
    attackShape: null,
    attackPhase: null,
    attackRemaining: 0,
    attackWindupTicks: rules.attackWindupTicks,
    attackCooldownTicks: 0,
    attackHit: false,
    attackTargetId: null,
    moveSpeed: rules.speed,
    attackRange: rules.attackRange,
  };
  moveEntity(world, enemy, 0, 0);
  world.entities.push(enemy);
  world.wave.spawned += 1;
  emit(world, 'spawn', {
    entityId: enemy.id,
    enemyKind: enemy.enemyKind,
    x: enemy.x,
    z: enemy.z,
  });
  return enemy;
}

function desiredEnemyCount(world) {
  return Math.min(6, 3 + Math.floor(world.wave.spawned / 12));
}

function ensureWave(world) {
  if (!world.players.length) return;
  const living = activeEnemies(world).length;
  if (!world.wave.initialized) {
    world.wave.initialized = true;
    world.wave.nextSpawnTick = world.tick + 30;
    while (activeEnemies(world).length < 3) {
      const nextKind = world.wave.spawned > 0 && world.wave.spawned % 5 === 4
        ? 'Skeleton_Warrior'
        : 'Skeleton_Minion';
      spawnEnemy(world, nextKind);
    }
    return;
  }
  const target = desiredEnemyCount(world);
  if (living >= target || world.tick < world.wave.nextSpawnTick) return;
  while (activeEnemies(world).length < target) {
    const nextKind = world.wave.spawned > 0 && world.wave.spawned % 5 === 4
      ? 'Skeleton_Warrior'
      : 'Skeleton_Minion';
    spawnEnemy(world, nextKind);
  }
  world.wave.nextSpawnTick = world.tick + 30;
}

export function createWorld({ seed = 1, arena = ARENA } = {}) {
  return {
    version: 1,
    mode: 'sandbox',
    tick: 0,
    seed: Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1,
    rngState: Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1,
    arena: copyArena(arena),
    entities: [],
    players: [],
    rewards: {},
    results: {},
    pendingHits: [],
    pendingImpacts: [],
    enemyHistory: [],
    doorCountdown: null,
    events: [],
    nextEntityId: 1,
    nextEventId: 1,
    wave: { initialized: false, nextSpawnTick: 0, spawned: 0 },
  };
}

function defineSoloAliases(world, playerId) {
  Object.defineProperties(world, {
    result: {
      configurable: true,
      get() {
        return world.results[playerId] ?? null;
      },
      set(value) {
        if (value == null) delete world.results[playerId];
        else world.results[playerId] = value;
      },
    },
    reward: {
      configurable: true,
      get() {
        return world.rewards[playerId];
      },
      set(value) {
        world.rewards[playerId] = value;
      },
    },
  });
}

export function addPlayer(world, {
  playerId,
  name = playerId,
  characterKind = 'knight',
  character = {},
} = {}) {
  const id = String(playerId ?? '').trim();
  if (!id) throw new TypeError('playerId is required');
  if (world.players.some((entityId) => world.entities.find((entity) => entity.id === entityId)?.playerId === id)) {
    throw new Error(`Player already exists: ${id}`);
  }

  const spawn = world.arena.playerSpawn;
  const level = world.mode === 'stage' || world.mode === 'hub'
    ? Math.max(1, Math.min(20, character.level ?? 1))
    : 1;
  const equipment = (character.equipment ?? []).map((item) => ({
    ...item,
    affixes: [...(item.affixes ?? [])],
  }));
  const look = equipmentLook(equipment);
  const lineage = lineageOf(character);
  const lineageFamily = playerFamily(character, look);
  const stats = world.mode === 'stage' || world.mode === 'hub'
    ? calculatePlayerStats(level, equipment, character.talents, lineageFamily)
    : null;
  const familySkills = skillsFor(lineageFamily, lineage);
  const masteryRanks = Object.fromEntries(familySkills.map((skillKey, index) => (
    [index + 1, masteryRank(character.mastery?.[skillKey])]
  )));
  const reward = {
    xp: 0, gold: 0, items: [], kills: {}, perfectDodges: 0, potionsUsed: 0, skillUses: {},
  };
  const player = {
    id: nextEntityId(world),
    kind: 'player',
    playerId: id,
    name: String(name ?? id).slice(0, 32),
    characterKind: look.characterKind,
    lineage,
    evolved: isEvolved(character),
    boneRevivalReady: world.mode === 'stage' && isSkeletonLineage(lineage),
    family: lineageFamily,
    masteryRanks,
    equipment,
    look,
    x: spawn.x,
    z: spawn.z,
    facing: -Math.PI / 2,
    radius: PLAYER_RADIUS,
    hp: stats?.maxHp ?? PLAYER_MAX_HP,
    maxHp: stats?.maxHp ?? PLAYER_MAX_HP,
    level,
    stats,
    connected: true,
    downed: false,
    reviveProgress: 0,
    dead: false,
    respawnTick: 0,
    previousButtons: 0,
    lastInput: { seq: 0, moveX: 0, moveZ: 0, aim: 192, buttons: 0 },
    attack: null,
    dodgeTicks: 0,
    dodgeVectorX: 0,
    dodgeVectorZ: 0,
    dodgeStartTick: null,
    dodgeCooldownRefundTicks: 0,
    dodgeBufferTicks: 0,
    perfectPaid: false,
    counterReadyTicks: 0,
    counterAttackerId: null,
    iFrames: 0,
    dodgeCooldownTicks: 0,
    hitFlashTicks: 0,
    moving: false,
    skillCooldowns: { 1: 0, 2: 0, 3: 0, 4: 0 },
    skillCast: null,
    pierceShotsRemaining: 0,
    guardTicks: 0,
    viewLag: 0,
    potions: world.mode === 'stage' ? Math.max(0, Math.min(POTION.maxCarry, character.potions ?? 0)) : 0,
    potionTicks: 0,
    potionCooldownTicks: 0,
    potionHealRemaining: 0,
    potionHealTicks: 0,
    attackSeq: 0,
    lichRefundedCastIds: [],
  };
  moveEntity(world, player, 0, 0);
  world.entities.push(player);
  world.players.push(player.id);
  world.rewards[id] = reward;
  if (world.mode !== 'stage' && world.mode !== 'hub') ensureWave(world);
  return player;
}

function startPlayerAttackMotion(player, step, seq) {
  const castId = `${player.playerId}:${seq}`;
  player.attack = {
    step,
    seq,
    castId,
    phase: 'windup',
    phaseTick: 0,
    queued: false,
    queuedSeq: null,
    hitTargets: [],
    shape: null,
  };
  return {
    entityId: player.id,
    playerId: player.playerId,
    castId,
    step,
  };
}

function beginPlayerAttack(world, player, step, seq) {
  emit(world, 'cast', startPlayerAttackMotion(player, step, seq));
}

function comboTimeline(player, step) {
  const timeline = COMBO_TIMELINES[step - 1];
  const speed = 1 + (player.stats?.attackSpeed ?? 0) / 100;
  if (player.family === 'crossbow' || player.family === 'staff') {
    const familyTimeline = player.family === 'crossbow'
      ? { windupTicks: 4, recoveryTicks: 8, range: 9, width: 0.5 }
      : { windupTicks: 5, recoveryTicks: 10, range: 8 };
    return {
      ...timeline,
      ...familyTimeline,
      windupTicks: Math.max(1, Math.round(familyTimeline.windupTicks / speed)),
      activeTicks: 1,
      recoveryTicks: Math.max(1, Math.round(familyTimeline.recoveryTicks / speed)),
    };
  }
  return {
    ...timeline,
    windupTicks: Math.max(1, Math.round(timeline.windupTicks / speed)),
    recoveryTicks: Math.max(1, Math.round(timeline.recoveryTicks / speed)),
  };
}

export function isAttackChainWindow(player) {
  if (!player?.attack || player.attack.phase !== 'recovery') return false;
  const timeline = comboTimeline(player, player.attack.step);
  return player.attack.phaseTick >= timeline.recoveryTicks - timeline.chainWindowTicks;
}

function queueCombo(player, seq) {
  const attack = player.attack;
  if (!attack || attack.step >= COMBO_TIMELINES.length || attack.queued) return;
  const timeline = comboTimeline(player, attack.step);
  if (
    attack.phase === 'recovery' &&
    attack.phaseTick >= timeline.recoveryTicks - timeline.chainWindowTicks
  ) {
    attack.queued = true;
    attack.queuedSeq = seq;
  }
}

function shieldGuardLowered(world, enemy) {
  return enemy.enemyKind === 'shieldbearer'
    && (
      (enemy.attackPattern === 'shield-bash' && (enemy.attackPhase !== null || enemy.recoverTicks > 0))
      || world.tick <= (enemy.shieldGuardDownUntilTick ?? 0)
    );
}

function damageEnemy(world, player, enemy, shape, timeline, castId) {
  enemy.hp = Math.max(0, enemy.hp - timeline.damage);
  enemy.hitFlashTicks = 7;
  const dx = enemy.x - player.x;
  const dz = enemy.z - player.z;
  const distance = Math.hypot(dx, dz) || 1;
  moveEntity(world, enemy, (dx / distance) * timeline.knockback, (dz / distance) * timeline.knockback);
  emit(world, 'hit', {
    sourceId: player.id,
    targetId: enemy.id,
    damage: timeline.damage,
    castId,
    shape: copyShape(shape),
  });
  if (enemy.hp === 0) {
    enemy.dead = true;
    enemy.deathTicks = 24;
    enemy.attackShape = null;
    enemy.attackPhase = null;
    world.wave.nextSpawnTick = Math.max(world.wave.nextSpawnTick, world.tick + 45);
    emit(world, 'death', { entityId: enemy.id, killerId: player.id, castId });
  }
}

function advancePlayerAttack(world, player) {
  const attack = player.attack;
  if (!attack) return;
  const timeline = comboTimeline(player, attack.step);
  if (attack.phase === 'active' && world.mode !== 'stage') {
    const shape = createAttackShape(player, player.facing, timeline.range, timeline.halfAngle);
    attack.shape = shape;
    for (const enemy of activeEnemies(world)) {
      if (attack.hitTargets.includes(enemy.id) || enemy.invulnerable || enemy.spawnTicksLeft > 0) continue;
      if (!inSector(shape, enemy, enemy.radius)) continue;
      attack.hitTargets.push(enemy.id);
      damageEnemy(world, player, enemy, shape, timeline, attack.castId);
    }
  }

  attack.phaseTick += 1;
  const phaseLength = attack.phase === 'windup'
    ? timeline.windupTicks
    : attack.phase === 'active'
      ? timeline.activeTicks
      : timeline.recoveryTicks;
  if (attack.phaseTick < phaseLength) return;

  if (attack.phase === 'windup') {
    attack.phase = 'active';
    attack.phaseTick = 0;
    return;
  }
  if (attack.phase === 'active') {
    attack.phase = 'recovery';
    attack.phaseTick = 0;
    attack.shape = null;
    return;
  }
  if (attack.queued && attack.step < COMBO_TIMELINES.length) {
    beginPlayerAttack(world, player, attack.step + 1, attack.queuedSeq);
  } else {
    player.attack = null;
  }
}

function stepPlayer(world, player, rawInput) {
  if (player.dead) {
    if (world.tick >= player.respawnTick) {
      const spawn = world.arena.playerSpawn;
      player.x = spawn.x;
      player.z = spawn.z;
      player.hp = player.maxHp;
      player.dead = false;
      player.attack = null;
      player.dodgeTicks = 0;
      player.iFrames = 0;
      player.hitFlashTicks = 0;
    }
    player.previousButtons = 0;
    player.lastInput = normalizeInput(player, rawInput);
    return;
  }

  const input = normalizeInput(player, rawInput);
  const pressed = input.buttons & ~player.previousButtons;
  player.previousButtons = input.buttons;
  player.lastInput = input;

  const moveX = input.moveX / 127;
  const moveZ = input.moveZ / 127;
  const magnitude = Math.hypot(moveX, moveZ);
  const directionX = magnitude > 1 ? moveX / magnitude : moveX;
  const directionZ = magnitude > 1 ? moveZ / magnitude : moveZ;
  player.moving = Math.abs(directionX) + Math.abs(directionZ) > 0.01;
  if (player.moving) player.facing = Math.atan2(directionZ, directionX);
  else player.facing = angleFromAim(input.aim);

  if ((pressed & BUTTONS.DODGE) && player.dodgeCooldownTicks === 0) {
    const facingX = Math.cos(player.facing);
    const facingZ = Math.sin(player.facing);
    player.dodgeVectorX = player.moving ? directionX : facingX;
    player.dodgeVectorZ = player.moving ? directionZ : facingZ;
    player.dodgeTicks = DODGE_DURATION_TICKS;
    player.iFrames = DODGE_IFRAME_TICKS;
    player.dodgeCooldownTicks = DODGE_COOLDOWN_TICKS;
    emit(world, 'dodge', { entityId: player.id, playerId: player.playerId });
  }

  if (player.dodgeTicks > 0) {
    const dashSpeed = 8.5 / TICK_HZ;
    moveEntity(world, player, player.dodgeVectorX * dashSpeed, player.dodgeVectorZ * dashSpeed);
  } else {
    moveEntity(world, player, directionX * PLAYER_SPEED / TICK_HZ, directionZ * PLAYER_SPEED / TICK_HZ);
  }

  if (pressed & BUTTONS.ATTACK) {
    if (!player.attack) beginPlayerAttack(world, player, 1, input.seq);
    else queueCombo(player, input.seq);
  }
  advancePlayerAttack(world, player);
}

function nearestPlayer(enemy, players) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const player of players) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = dx * dx + dz * dz;
    if (distance < nearestDistance || (distance === nearestDistance && player.id < nearest?.id)) {
      nearest = player;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function damagePlayer(world, enemy, player, shape, damage) {
  const blocked = player.dead || player.iFrames > 0;
  if (!blocked) {
    player.hp = Math.max(0, player.hp - damage);
    player.hitFlashTicks = 8;
    if (player.hp === 0) {
      player.dead = true;
      player.respawnTick = world.tick + PLAYER_RESPAWN_TICKS;
      player.attack = null;
      player.dodgeTicks = 0;
      emit(world, 'death', { entityId: player.id, playerId: player.playerId, respawnTick: player.respawnTick });
    }
  }
  emit(world, 'hit', {
    sourceId: enemy.id,
    targetId: player.id,
    damage: blocked ? 0 : damage,
    blocked,
    shape: copyShape(shape),
  });
}

function queueEnemyHit(world, enemy, player, shape, damage = null, motionMult = 1, knockback = 0) {
  world.pendingHits.push({
    resolveTick: world.tick + 1,
    sourceId: enemy.id,
    targetId: player.id,
    shape: copyShape(shape),
    damage,
    motionMult,
    knockback,
  });
}

function currentWard(world) {
  const objective = world.objective;
  if (objective?.type !== 'defend' || objective.state !== 'active') return null;
  return {
    id: WARD_TARGET_ID,
    x: objective.x,
    z: objective.z,
    radius: objective.radius,
    ward: true,
  };
}

function failObjective(world) {
  const objective = world.objective;
  if (!objective || objective.state !== 'active') return;
  objective.state = 'failed';
  emit(world, 'objectiveFailed', { objectiveType: objective.type, roomIndex: objective.roomIndex });
}

function completeObjective(world, position = null) {
  const objective = world.objective;
  if (!objective || objective.state !== 'active') return;
  objective.state = 'success';
  if (objective.type === 'channel') {
    objective.nextSpawnIndex = objective.pendingSpawns.length;
  }
  emit(world, 'objectiveComplete', { objectiveType: objective.type, roomIndex: objective.roomIndex });
  const x = position?.x ?? objective.x ?? 0;
  const z = position?.z ?? objective.z ?? world.arena.rooms[objective.roomIndex]?.centerZ ?? 0;
  const bonusGold = objectiveBonusGold(STAGES[world.stageId], world.difficulty);
  for (const player of stagePlayers(world)) {
    autoCollectGold(world, player, bonusGold, x, z);
    const item = rollStageItem(world, {
      stageLevel: world.effectiveLevel ?? world.stageLevel,
      elite: true,
      forcedRarity: 'rare',
      family: player.family,
      lineage: player.lineage,
    });
    spawnLoot(world, x, z, { ownerId: player.playerId, lootType: 'item', item });
  }
}

function damageWard(world, enemy, hit) {
  const objective = world.objective;
  const ward = currentWard(world);
  if (
    !ward
    || !enemy?.objectiveTarget
    || !world.entities.some((entity) => entity.id === enemy.id && !entity.dead)
    || !attackShapeHit(hit.shape, ward, ward.radius)
  ) return false;
  const damage = calculateDamage(enemy.attack, hit.motionMult ?? 1, false, 1, 0);
  objective.hp = Math.max(0, objective.hp - damage);
  emit(world, 'objectiveWardHit', {
    sourceId: enemy.id,
    targetId: WARD_TARGET_ID,
    damage,
    hp: objective.hp,
    maxHp: objective.maxHp,
  });
  if (objective.hp <= 0) failObjective(world);
  return true;
}

function advanceObjective(world) {
  const objective = world.objective;
  if (!objective || objective.state !== 'active') return;
  if (objective.type === 'hunt' && world.tick >= objective.endsTick) {
    const target = world.entities.find((entity) => entity.id === objective.targetId);
    if (target && !target.dead) {
      failObjective(world);
      return;
    }
  }
  while (
    objective.nextSpawnIndex < (objective.pendingSpawns?.length ?? 0)
    && world.tick >= objective.pendingSpawns[objective.nextSpawnIndex].tick
  ) {
    const spawn = objective.pendingSpawns[objective.nextSpawnIndex];
    for (let count = 0; count < spawn.count; count += 1) {
      spawnStageEnemy(
        world,
        spawn.enemy,
        objective.spawnIndex,
        false,
        null,
        null,
        { objectiveTarget: objective.type === 'defend' },
      );
      objective.spawnIndex += 1;
    }
    objective.nextSpawnIndex += 1;
  }
}

function advanceChannelObjective(world, players) {
  const objective = world.objective;
  if (objective?.type !== 'channel' || objective.state !== 'active') return;
  if (players.some((player) => Math.hypot(player.x - objective.x, player.z - objective.z) <= objective.radius)) {
    objective.progress += 1;
    if (objective.progress >= objective.required) completeObjective(world);
  }
}

function updateObjectiveProgress(world) {
  const objective = world.objective;
  if (!objective || objective.state !== 'active') return;
  const pendingSpawns = objective.nextSpawnIndex < (objective.pendingSpawns?.length ?? 0);
  const living = stageActiveEnemies(world);
  if (objective.type === 'defend') {
    if (objective.hp <= 0) failObjective(world);
    else if (!pendingSpawns && !living.length) completeObjective(world);
  } else if (objective.type === 'channel') {
    if (objective.progress >= objective.required) completeObjective(world);
    else if (!pendingSpawns && !living.length) failObjective(world);
  }
}

function resolvePendingHits(world, iFramesAtTickStart = new Map()) {
  const due = [];
  world.pendingHits = world.pendingHits.filter((hit) => {
    if (hit.resolveTick > world.tick) return true;
    due.push(hit);
    return false;
  });
  for (const hit of due) {
    const enemy = world.entities.find((entity) => entity.id === hit.sourceId);
    if (hit.targetId === WARD_TARGET_ID) {
      damageWard(world, enemy, hit);
      continue;
    }
    const player = world.entities.find((entity) => entity.id === hit.targetId);
    if (
      !enemy ||
      !player ||
      player.dead ||
      player.downed ||
      !player.connected
    ) continue;
    if (player.iFrames > 0 || (iFramesAtTickStart.get(player.id) ?? 0) > 0) {
      if (world.mode === 'stage' && enemy.kind === 'enemy') awardPerfectDodge(world, enemy, player);
      continue;
    }
    if (world.mode === 'stage') damagePlayerM1(world, enemy, player, hit.shape, hit.motionMult ?? 1, hit.knockback ?? 0);
    else damagePlayer(world, enemy, player, hit.shape, hit.damage ?? Math.round(enemy.attack * (hit.motionMult ?? 1)));
  }
}

function awardPerfectDodge(world, attacker, player) {
  if (
    player.perfectPaid ||
    player.dodgeStartTick === null ||
    player.dodgeTicks <= 0 ||
    world.tick - player.dodgeStartTick >= (world.partySize > 1 ? PARTY_PERFECT_DODGE_TICKS : PERFECT_DODGE_TICKS)
  ) return;
  player.perfectPaid = true;
  world.rewards[player.playerId].perfectDodges += 1;
  player.counterReadyTicks = player.stats.counterReadyTicks ?? 60;
  player.counterAttackerId = attacker.id;
  const pierceGrant = (player.stats.pierceShots ?? 0)
    + (player.evolved && player.lineage === 'skeleton_archer' ? 2 : 0);
  player.pierceShotsRemaining = Math.max(player.pierceShotsRemaining ?? 0, pierceGrant);
  player.dodgeCooldownTicks = Math.max(0, player.dodgeCooldownTicks - player.dodgeCooldownRefundTicks);
  emit(world, 'perfectDodge', {
    entityId: player.id,
    playerId: player.playerId,
    attackerId: attacker.id,
  });
}

function clearEnemyAttack(enemy, rules) {
  enemy.attackShape = null;
  enemy.attackPhase = null;
  enemy.attackRemaining = 0;
  enemy.attackTargetId = null;
  enemy.attackCooldownTicks = rules.attackCooldownTicks;
}

function stepEnemy(world, enemy, players) {
  if (enemy.spawnTicksLeft > 0) {
    enemy.spawnTicksLeft -= 1;
    enemy.invulnerable = enemy.spawnTicksLeft > 0;
    return;
  }

  const rules = ENEMY_RULES[enemy.enemyKind];
  if (enemy.attackCooldownTicks > 0) enemy.attackCooldownTicks -= 1;
  const target = nearestPlayer(enemy, players);
  if (!target) return;

  if (enemy.attackPhase === 'windup') {
    if (enemy.attackRemaining > 1) {
      enemy.attackRemaining -= 1;
      return;
    }
    enemy.attackPhase = 'active';
    enemy.attackRemaining = rules.attackDurationTicks;
    enemy.attackHit = false;
    return;
  }
  if (enemy.attackPhase === 'active') {
    if (!enemy.attackHit) {
      enemy.attackHit = true;
      if (inSector(enemy.attackShape, target, target.radius)) {
        queueEnemyHit(world, enemy, target, enemy.attackShape, rules.damage);
      }
    }
    enemy.attackRemaining -= 1;
    if (enemy.attackRemaining <= 0) clearEnemyAttack(enemy, rules);
    return;
  }

  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.0001) return;
  enemy.facing = Math.atan2(dz, dx);
  if (distance <= rules.attackRange) {
    if (enemy.attackCooldownTicks > 0) return;
    enemy.attackShape = createAttackShape(enemy, enemy.facing, rules.attackRange, rules.attackHalfAngle);
    enemy.attackPhase = 'windup';
    enemy.attackRemaining = rules.attackWindupTicks;
    enemy.attackWindupTicks = rules.attackWindupTicks;
    enemy.attackHit = false;
    enemy.attackTargetId = target.id;
    return;
  }
  if (enemy.attackCooldownTicks === 0) {
    moveEntity(world, enemy, (dx / distance) * rules.speed / TICK_HZ, (dz / distance) * rules.speed / TICK_HZ);
  }
}

function separateEnemies(world) {
  const enemies = activeEnemies(world);
  for (let left = 0; left < enemies.length; left += 1) {
    for (let right = left + 1; right < enemies.length; right += 1) {
      const a = enemies[left];
      const b = enemies[right];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      const minimum = a.radius + b.radius;
      if (distance >= minimum) continue;
      const directionX = distance > 0 ? dx / distance : 1;
      const directionZ = distance > 0 ? dz / distance : 0;
      const push = (minimum - distance) * 0.25;
      moveEntity(world, a, -directionX * push, -directionZ * push);
      moveEntity(world, b, directionX * push, directionZ * push);
    }
  }
}

function cleanupEntities(world) {
  world.entities = world.entities.filter((entity) => entity.kind !== 'enemy' || !entity.dead || entity.deathTicks > 0);
}

export function xpToNextLevel(level) {
  return Math.round(60 * Math.pow(level, 1.6));
}

export function calculateDamage(atk, motionMult, crit, critDmg, defense) {
  return Math.max(1, Math.round(atk * motionMult * (crit ? critDmg : 1) * 100 / (100 + defense)));
}

export function calculatePlayerStats(level = 1, equipment = [], talents = null, familyOverride = null) {
  let maxHp = 100 + 12 * (level - 1);
  let attack = 10 + 2 * (level - 1);
  let defense = 0;
  let critChance = 5;
  let critDamage = 150;
  let attackSpeed = 0;
  let moveSpeed = PLAYER_SPEED;
  let dodgeCooldownReduction = 0;
  let skillCooldownReduction = 0;
  let lifesteal = 0;
  let goldGain = 0;
  let xpGain = 0;
  let spinCooldownSeconds = 0;
  let counterDamagePct = 0;
  let counterReadyTicks = 60;
  let pierceShots = 0;
  let counterFireField = false;
  const setCounts = {};
  for (const item of equipment) {
    const base = ITEMS[item.itemId];
    const setId = base?.setId;
    if (setId && ITEM_SETS[setId]) setCounts[setId] = (setCounts[setId] ?? 0) + 1;
    if (base) {
      const bonus = item.enhance ? item.enhance * Math.max(1, Math.round(base.value * 0.08)) : 0;
      const value = base.value + bonus;
      if (base.stat === 'maxHp') maxHp += value;
      if (base.stat === 'attack') attack += value;
      if (base.stat === 'defense') defense += value;
    }
    for (const affix of item.affixes ?? []) {
      const key = affix.id;
      const value = Number(affix.value) || 0;
      if (key === 'attackPercent') attack += Math.round(attack * value / 100);
      if (key === 'maxHp') maxHp += value;
      if (key === 'defense') defense += value;
      if (key === 'critChance') critChance += value;
      if (key === 'critDamage') critDamage += value;
      if (key === 'attackSpeed') attackSpeed += value;
      if (key === 'moveSpeed') moveSpeed *= 1 + value / 100;
      if (key === 'dodgeCooldownReduction') dodgeCooldownReduction += value;
      if (key === 'skillCooldownReduction') skillCooldownReduction += value;
      if (key === 'lifesteal') lifesteal += value;
      if (key === 'goldGain') goldGain += value;
      if (key === 'xpGain') xpGain += value;
      if (key === 'spinCooldownSeconds') spinCooldownSeconds += value;
    }
  }
  const family = familyOverride ?? equipmentLook(equipment).family;
  const ranks = normalizedTalents(talents)[family];
  const talentBonuses = {};
  for (const { id, stat, perRank } of TALENTS[family]) {
    talentBonuses[stat] = (talentBonuses[stat] ?? 0) + (ranks[id] ?? 0) * perRank;
  }
  const talentBonus = (stat) => talentBonuses[stat] ?? 0;
  maxHp = Math.round(maxHp * (1 + talentBonus('maxHpPct') / 100));
  attack = Math.round(attack * (1 + talentBonus('attackPct') / 100));
  defense += talentBonus('defense');
  critChance += talentBonus('critChance');
  critDamage += talentBonus('critDamage');
  attackSpeed += talentBonus('attackSpeed');
  moveSpeed *= 1 + talentBonus('moveSpeedPct') / 100;
  dodgeCooldownReduction += talentBonus('dodgeCooldownReduction');
  skillCooldownReduction += talentBonus('skillCooldownReduction');
  lifesteal += talentBonus('lifesteal');
  const familySetCount = (setId) => (
    ITEM_SETS[setId].family === family ? setCounts[setId] ?? 0 : 0
  );
  if (familySetCount('guardian-oath') >= 2) maxHp = Math.round(maxHp * 1.15);
  if (familySetCount('guardian-oath') >= 4) {
    counterDamagePct = 40;
    counterReadyTicks = 90;
  }
  if (familySetCount('shadow-hunter') >= 2) attackSpeed += 10;
  if (familySetCount('shadow-hunter') >= 4) pierceShots = 3;
  if (familySetCount('ember-sage') >= 2) skillCooldownReduction += 15;
  if (familySetCount('ember-sage') >= 4) counterFireField = true;
  counterDamagePct += talentBonus('counterDamagePct');
  return {
    maxHp: Math.max(1, maxHp),
    attack: Math.max(1, attack),
    defense: Math.max(0, defense),
    critChance: Math.max(0, Math.min(75, critChance)),
    critDamage: Math.max(100, critDamage) / 100,
    attackSpeed,
    moveSpeed,
    dodgeCooldownReduction: Math.min(60, dodgeCooldownReduction),
    skillCooldownReduction,
    lifesteal,
    goldGain,
    xpGain,
    spinCooldownSeconds,
    counterDamagePct,
    counterReadyTicks,
    pierceShots,
    counterFireField,
    setCounts,
  };
}

export function rarityForRoll(value, { elite = false, boss = false, difficulty = 'normal' } = {}) {
  const table = difficulty === 'nightmare'
    ? boss ? BOSS_RARITIES_NIGHTMARE : ELITE_RARITIES
    : difficulty === 'hell' && boss
      ? BOSS_RARITIES_HELL
      : boss ? BOSS_RARITIES : elite ? ELITE_RARITIES
        : Object.entries(RARITIES).map(([rarity, entry]) => ({ rarity, weight: entry.weight }));
  let cursor = value * table.reduce((sum, row) => sum + row.weight, 0);
  for (const entry of table) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.rarity;
  }
  return table.at(-1).rarity;
}

function eligibleSetBases(setId, itemLevel) {
  return ITEM_BASES.filter((item) => item.setId === setId && item.requiredLevel <= itemLevel);
}

function rollAffix(world, ilvl) {
  const ids = Object.keys(AFFIXES);
  const id = ids[Math.floor(random(world) * ids.length)];
  const value = rollAffixValue(id, ilvl, random(world));
  return { id, value };
}

export function rollStageItem(world, options = {}) {
  const {
    elite = false,
    boss = false,
    forcedRarity = null,
  } = options;
  const difficulty = options.difficulty ?? world.difficulty ?? 'normal';
  const stageLevel = Math.min(20, options.stageLevel ?? world.effectiveLevel ?? world.stageLevel ?? 1);
  const itemLevel = Math.min(20, stageLevel + (boss ? 2 : 0));
  const rarity = forcedRarity ?? rarityForRoll(random(world), { elite, boss, difficulty });
  if (!RARITIES[rarity]) throw new TypeError(`Unknown item rarity: ${rarity}`);
  const firstPlayer = world.entities?.find((entity) => entity.kind === 'player');
  const family = options.family ?? firstPlayer?.family;
  const lineage = options.lineage ?? firstPlayer?.lineage ?? 'human';
  const setId = options.setId ?? (
    rarity === 'set'
      ? Object.entries(ITEM_SETS).find(([, set]) => set.family === family)?.[0]
      : null
  );
  const bases = rarity === 'set'
    ? eligibleSetBases(setId, itemLevel)
    : ITEM_BASES.filter((item) => !item.setId && item.requiredLevel <= stageLevel);
  if (!bases.length) throw new TypeError('No eligible item base for this drop');
  const rolledBase = bases[Math.floor(random(world) * bases.length)];
  let base = rolledBase;
  if (
    !rolledBase.setId
    && isSkeletonLineage(lineage)
    && rolledBase.slot === 'weapon'
    && rolledBase.family !== family
  ) {
    const familyWeapons = ITEM_BASES.filter((item) => (
      !item.setId
      && item.slot === 'weapon'
      && item.family === family
      && item.requiredLevel <= stageLevel
    ));
    if (familyWeapons.length) {
      base = familyWeapons[Math.floor(random(world) * familyWeapons.length)];
    }
  }
  const ilvl = itemLevel;
  const affixCount = RARITIES[rarity].affixes;
  const affixes = [];
  while (affixes.length < affixCount) {
    const affix = rollAffix(world, ilvl);
    if (!affixes.some((item) => item.id === affix.id)) affixes.push(affix);
  }
  const legendary = rarity === 'legendary'
    ? LEGENDARIES[Math.floor(random(world) * LEGENDARIES.length)]
    : null;
  if (legendary) affixes.push({ id: legendary.stat, value: legendary.value, unique: legendary.id });
  return {
    itemId: base.id,
    rarity,
    ilvl,
    enhance: 0,
    affixes,
    legendaryId: legendary?.id ?? null,
    ...(base.setId ? { setId: base.setId } : {}),
  };
}

export function createStageWorld({
  seed = 1,
  stageId = 'C1',
  difficulty = 'normal',
  playerId = 'hero',
  character = {},
  party,
  inputDriven = false,
} = {}) {
  const stage = STAGES[stageId];
  if (!stage) throw new TypeError(`Unknown stage: ${stageId}`);
  const tier = DIFFICULTIES[difficulty];
  if (!tier) throw new TypeError(`Unknown difficulty: ${difficulty}`);
  const members = party ?? [{ playerId, character }];
  if (!Array.isArray(members) || members.length < 1 || members.length > 4) {
    throw new RangeError('A stage party must contain one to four players');
  }
  const world = createWorld({ seed, arena: stage });
  world.mode = 'stage';
  world.stageId = stageId;
  world.stageLevel = stage.stageLevel;
  world.difficulty = difficulty;
  world.effectiveLevel = effectiveStageLevel(stage, difficulty);
  world.powerMult = stage.powerMult ?? 1;
  world.rewardMult = stage.rewardMult ?? 1;
  world.partySize = members.length;
  world.inputDriven = Boolean(inputDriven || members.length > 1);
  world.roomIndex = 0;
  world.objective = null;
  world.roomEnemyIds = [];
  world.roomCleared = false;
  world.openDoors = {};
  world.outcome = null;
  world.bossThresholds = {};
  for (const member of members) {
    addPlayer(world, {
      playerId: member.playerId,
      name: member.name,
      characterKind: member.characterKind ?? 'knight',
      character: member.character ?? {},
    });
  }
  if (members.length === 1) {
    world.soloPlayerId = world.entities.find((entity) => entity.kind === 'player').playerId;
    defineSoloAliases(world, world.soloPlayerId);
  }
  spawnRoom(world);
  recordEnemyHistory(world);
  return world;
}

export function createHubWorld({
  seed = 1, playerId = 'hero', level = 1, equipment = [], talents = null, lineage = 'human', clearedStages = [],
} = {}) {
  const world = createWorld({ seed, arena: HUB_ARENA });
  world.mode = 'hub';
  addPlayer(world, {
    playerId,
    characterKind: 'knight',
    character: { level, equipment, talents, lineage, clearedStages },
  });
  return world;
}

function stagePoint(world, index) {
  const points = world.arena.spawnPoints[world.roomIndex] ?? [];
  return points[index % Math.max(1, points.length)] ?? world.arena.playerSpawn;
}

function stageEnemyAttackScale(world, elite = false) {
  const tier = DIFFICULTIES[world.difficulty ?? 'normal'];
  const scale = 1 + 0.12 * ((world.effectiveLevel ?? world.stageLevel) - 1);
  return scale * tier.atkMult * (world.powerMult ?? 1) * (elite ? 1.3 : 1);
}

function spawnStageEnemy(world, enemyType, index, elite = false, position = null, summonedBy = null, {
  objectiveTarget = false,
  bounty = false,
} = {}) {
  const rule = ENEMIES[enemyType];
  if (!rule) throw new TypeError(`Unknown enemy type: ${enemyType}`);
  const point = position ?? stagePoint(world, index);
  const tier = DIFFICULTIES[world.difficulty ?? 'normal'];
  const scale = 1 + 0.12 * ((world.effectiveLevel ?? world.stageLevel) - 1);
  const partyScale = 1 + 0.75 * ((world.partySize ?? 1) - 1);
  const soloMaxHp = Math.max(1, Math.round(
    rule.hp * scale * tier.hpMult * (world.powerMult ?? 1) * (elite ? 2.5 : 1),
  ));
  const maxHp = Math.max(1, Math.round(soloMaxHp * partyScale));
  const enemy = {
    id: nextEntityId(world),
    kind: 'enemy',
    enemyKind: enemyType,
    model: rule.model,
    ...(rule.tint ? { tint: rule.tint } : {}),
    x: point.x,
    z: point.z,
    facing: Math.PI / 2,
    radius: rule.radius,
    hp: maxHp,
    maxHp,
    attack: Math.max(1, Math.round(rule.attack * stageEnemyAttackScale(world, elite))),
    speed: rule.speed,
    dead: false,
    deathTicks: 0,
    spawnTicksLeft: 30,
    invulnerable: true,
    hitFlashTicks: 0,
    attackShape: null,
    attackPhase: null,
    attackRemaining: 0,
    attackWindupTicks: rule.windupTicks ?? 0,
    attackCooldownTicks: 0,
    attackHit: false,
    attackTargetId: null,
    attackPattern: null,
    shieldGuardDownUntilTick: 0,
    attackPatternIndex: 0,
    boneSpearCooldownTicks: 0,
    stunnedTicks: 0,
    slowTicks: 0,
    elite,
    ...(objectiveTarget ? { objectiveTarget: true } : {}),
    ...(bounty ? { bounty: true } : {}),
    boss: ['commander', 'ashwarden', 'skeletonking'].includes(enemyType),
    summoned: Boolean(summonedBy),
    ...(summonedBy ? { summonedBy } : {}),
    summonCooldownTicks: 0,
    hitCountSinceBlink: 0,
    lastBlinkTick: world.tick,
    recoverTicks: 0,
    lineTravelTicks: 0,
    lineTravelled: 0,
    currentRoomId: world.arena.rooms[world.roomIndex]?.id,
  };
  if (rule.scale) enemy.modelScale = rule.scale;
  moveEntity(world, enemy, 0, 0);
  world.entities.push(enemy);
  world.roomEnemyIds.push(enemy.id);
  emit(world, 'spawn', { entityId: enemy.id, enemyKind: enemyType, x: enemy.x, z: enemy.z, elite, boss: enemy.boss });
  return enemy;
}

function spawnRoom(world) {
  const room = world.arena.rooms[world.roomIndex];
  if (!room) return;
  world.roomEnemyIds = [];
  world.roomCleared = false;
  const modifiers = ['C2', 'C3'].includes(world.stageId) ? room.waves.length : 0;
  let eliteIndex = -1;
  if (modifiers && random(world) < 0.15) {
    const total = room.waves.reduce((sum, wave) => sum + wave.count, 0);
    eliteIndex = Math.floor(random(world) * total);
  }
  let index = 0;
  for (const wave of room.waves) {
    for (let count = 0; count < wave.count; count += 1) {
      spawnStageEnemy(world, wave.enemy, index, index === eliteIndex);
      index += 1;
    }
  }
  if (!room.objective) return;
  const startTick = world.tick;
  const objective = {
    type: room.objective.type,
    roomIndex: world.roomIndex,
    state: 'active',
    startTick,
  };
  if (room.objective.type === 'hunt') {
    objective.endsTick = startTick + room.objective.timeSec * TICK_HZ;
    const target = spawnStageEnemy(world, room.objective.target, index, false, null, null, { bounty: true });
    objective.targetId = target.id;
  } else if (room.objective.type === 'defend') {
    const maxHp = Math.round(
      room.objective.hp
      * stageEnemyAttackScale(world)
      * (1 + 0.5 * ((world.partySize ?? 1) - 1)),
    );
    Object.assign(objective, {
      x: 0,
      z: room.centerZ,
      radius: 0.8,
      hp: maxHp,
      maxHp,
      pendingSpawns: room.objective.spawns.map((spawn) => ({
        tick: startTick + spawn.atSec * TICK_HZ,
        enemy: spawn.enemy,
        count: spawn.count,
      })),
      nextSpawnIndex: 0,
      spawnIndex: index,
    });
  } else if (room.objective.type === 'channel') {
    Object.assign(objective, {
      x: 0,
      z: room.centerZ,
      radius: room.objective.radius,
      progress: 0,
      required: room.objective.channelSec * TICK_HZ,
      pendingSpawns: room.objective.spawns.map((spawn) => ({
        tick: startTick + spawn.atSec * TICK_HZ,
        enemy: spawn.enemy,
        count: spawn.count,
      })),
      nextSpawnIndex: 0,
      spawnIndex: index,
    });
  }
  world.objective = objective;
  emit(world, 'objectiveStart', { type: objective.type, roomIndex: objective.roomIndex });
}

function stageActiveEnemies(world) {
  const activeIds = new Set(world.roomEnemyIds);
  return world.entities.filter((entity) => entity.kind === 'enemy' && !entity.dead && activeIds.has(entity.id));
}

export function attackShapeHit(shape, target, targetRadius = 0) {
  if (!shape) return false;
  if (shape.type === 'sector') return inSector(shape, target, targetRadius);
  if (shape.type === 'circle') return Math.hypot(target.x - shape.originX, target.z - shape.originZ) <= shape.radius + targetRadius;
  if (shape.type === 'annulus') {
    const distance = Math.hypot(target.x - shape.originX, target.z - shape.originZ);
    return distance + targetRadius >= shape.innerRadius && distance - targetRadius <= shape.outerRadius;
  }
  if (shape.type === 'circles') return shape.circles.some((circle) => Math.hypot(target.x - circle.x, target.z - circle.z) <= circle.radius + targetRadius);
  if (shape.type === 'rect') {
    const dx = target.x - shape.originX;
    const dz = target.z - shape.originZ;
    const forward = dx * Math.cos(shape.angle) + dz * Math.sin(shape.angle);
    const side = Math.abs(-dx * Math.sin(shape.angle) + dz * Math.cos(shape.angle));
    return forward >= -targetRadius && forward <= shape.length + targetRadius && side <= shape.width / 2 + targetRadius;
  }
  if (shape.type === 'line') {
    const dx = target.x - shape.originX;
    const dz = target.z - shape.originZ;
    const forward = dx * Math.cos(shape.angle) + dz * Math.sin(shape.angle);
    const side = Math.abs(-dx * Math.sin(shape.angle) + dz * Math.cos(shape.angle));
    return forward >= -targetRadius && forward <= shape.length + targetRadius && side <= shape.width / 2 + targetRadius;
  }
  return false;
}

function enemyHistoryFrame(world, viewLag) {
  if (!Number.isFinite(viewLag) || !Array.isArray(world?.enemyHistory) || !Number.isSafeInteger(world.tick)) return null;
  const clampedTick = world.tick - clamp(Math.trunc(viewLag), 0, 12);
  if (clampedTick >= world.tick) return null;
  return world.enemyHistory.find((frame) => frame.tick === clampedTick) ?? null;
}

export function pickAimTarget(world, player, range) {
  const history = enemyHistoryFrame(world, player.viewLag ?? 0);
  const roomEnemyIds = Array.isArray(world.roomEnemyIds) ? new Set(world.roomEnemyIds) : null;
  const activeEnemyIds = Array.isArray(world.activeEnemyIds) ? new Set(world.activeEnemyIds) : null;
  const candidates = (world.entities ?? [])
    .filter((enemy) => (
      enemy.kind === 'enemy' &&
      !enemy.dead &&
      enemy.state !== 'dead' &&
      !enemy.invulnerable &&
      (enemy.spawnTicksLeft ?? 0) <= 0 &&
      (!roomEnemyIds || roomEnemyIds.has(enemy.id)) &&
      (!activeEnemyIds || activeEnemyIds.has(enemy.id))
    ))
    .map((enemy) => {
      const historical = history?.enemies.find((entry) => entry.id === enemy.id);
      if (history && (!historical || historical.dead)) return null;
      const target = historical ? { ...enemy, ...historical } : enemy;
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      const distance = Math.hypot(dx, dz);
      return distance <= range
        ? { target, distance, angle: Math.atan2(dz, dx) }
        : null;
    })
    .filter(Boolean);
  const nearest = (halfAngle) => candidates
    .filter((candidate) => Math.abs(angleDifference(candidate.angle, player.facing)) <= halfAngle)
    .sort((a, b) => a.distance - b.distance || a.target.id - b.target.id)[0]?.target ?? null;
  return nearest(Math.PI * 35 / 180) ?? nearest(Math.PI / 2);
}

function aimedPoint(world, player, range, fallbackDistance, input) {
  if (Number.isFinite(input?.ad)) {
    const angle = angleFromAim(input.aim);
    const distance = clamp(input.ad, 0, range);
    return {
      x: player.x + Math.cos(angle) * distance,
      z: player.z + Math.sin(angle) * distance,
      targetId: null,
    };
  }
  const target = pickAimTarget(world, player, range);
  if (target) return { x: target.x, z: target.z, targetId: target.id };
  return {
    x: player.x + Math.cos(player.facing) * fallbackDistance,
    z: player.z + Math.sin(player.facing) * fallbackDistance,
    targetId: null,
  };
}

function recordEnemyHistory(world) {
  const frame = {
    tick: world.tick,
    enemies: world.entities
      .filter((entity) => entity.kind === 'enemy')
      .map((enemy) => ({
        id: enemy.id,
        x: enemy.x,
        z: enemy.z,
        radius: enemy.radius,
        facing: enemy.facing,
        dead: enemy.dead,
      }))
      .sort((a, b) => a.id - b.id),
  };
  const previous = world.enemyHistory.at(-1);
  if (previous?.tick === world.tick) world.enemyHistory[world.enemyHistory.length - 1] = frame;
  else world.enemyHistory.push(frame);
  if (world.enemyHistory.length > 13) world.enemyHistory.splice(0, world.enemyHistory.length - 13);
}

function makeLineShape(x, z, angle, length, width) {
  return { type: 'line', originX: x, originZ: z, angle, length, width };
}

function makeAnnulusShape(x, z, innerRadius, outerRadius) {
  return { type: 'annulus', originX: x, originZ: z, innerRadius, outerRadius };
}

function randomGold(world, stageLevel, player) {
  const rule = { min: 2, max: 5 };
  const amount = (rule.min + Math.floor(random(world) * (rule.max - rule.min + 1))) * stageLevel;
  const goldMult = DIFFICULTIES[world.difficulty ?? 'normal'].goldMult;
  return Math.max(1, Math.round(
    amount * goldMult * (1 + (player?.stats.goldGain ?? 0) / 100) * (world.rewardMult ?? 1),
  ));
}

function spawnLoot(world, x, z, loot) {
  const entity = {
    id: nextEntityId(world),
    kind: 'loot',
    x,
    z,
    radius: 0.18,
    ...loot,
    ownerId: loot.ownerId ?? stagePlayers(world)[0]?.playerId ?? null,
  };
  world.entities.push(entity);
  emit(world, 'lootSpawn', {
    lootId: entity.id,
    ownerId: entity.ownerId,
    x,
    z,
    rarity: entity.item?.rarity ?? null,
    gold: entity.gold ?? 0,
  });
  if (entity.item) entity.item.uid = createLootUid(world.seed, world.stageId, world.nextEventId - 1);
  return entity;
}

function autoCollectGold(world, player, gold, x, z) {
  world.rewards[player.playerId].gold += gold;
  emit(world, 'pickup', {
    entityId: player.id,
    playerId: player.playerId,
    lootId: null,
    lootType: 'gold',
    gold,
    auto: true,
    x,
    z,
  });
}

export function createLootUid(seed, stageId, eventId) {
  return `${seed}:${stageId}:${eventId}`;
}

function dropRewards(world, enemy) {
  const rule = ENEMIES[enemy.enemyKind];
  const rewardScale = enemy.summoned ? 0.25 : 1;
  const guaranteedCount = enemy.boss ? 2 : enemy.elite ? 1 : 0;
  const chance = enemy.elite || enemy.boss ? 1 : rule.dropChance;
  const difficulty = DIFFICULTIES[world.difficulty ?? 'normal'];
  const stageLevel = world.effectiveLevel ?? world.stageLevel;
  for (const player of stagePlayers(world)) {
    const reward = world.rewards[player.playerId];
    reward.kills[enemy.enemyKind] = (reward.kills[enemy.enemyKind] ?? 0) + 1;
    const xp = Math.round(rule.xp * rewardScale * difficulty.xpMult * (1 + (player.stats.xpGain ?? 0) / 100));
    reward.xp += xp;
    emit(world, 'xp', { amount: xp, entityId: enemy.id, playerId: player.playerId });
    const gold = Math.max(1, Math.round(randomGold(world, stageLevel, player) * rewardScale));
    autoCollectGold(world, player, gold, enemy.x, enemy.z);

    if (enemy.summoned) continue;
    if (guaranteedCount) {
      for (let index = 0; index < guaranteedCount; index += 1) {
        const setId = enemy.boss && world.difficulty !== 'normal'
          ? Object.entries(ITEM_SETS).find(([, set]) => set.family === player.family)?.[0]
          : null;
        const setDropRoll = Boolean(setId && random(world) < 0.25);
        const setAvailable = eligibleSetBases(setId, Math.min(20, stageLevel + 2)).length > 0;
        const setDrop = Boolean(setDropRoll && setAvailable);
        const item = rollStageItem(world, setDrop
          ? { stageLevel, boss: true, forcedRarity: 'set', setId, family: player.family, lineage: player.lineage }
          : { stageLevel, elite: enemy.elite, boss: enemy.boss, family: player.family, lineage: player.lineage });
        spawnLoot(world, enemy.x + (index ? 0.3 : -0.3), enemy.z, {
          ownerId: player.playerId,
          lootType: 'item',
          item,
        });
      }
    } else if (random(world) < chance) {
      const item = rollStageItem(world, {
        stageLevel,
        elite: enemy.elite,
        family: player.family,
        lineage: player.lineage,
      });
      spawnLoot(world, enemy.x + (random(world) - 0.5) * 0.5, enemy.z + (random(world) - 0.5) * 0.5, {
        ownerId: player.playerId,
        lootType: 'item',
        item,
      });
    }
    const potionChance = enemy.boss ? POTION_DROP.boss : enemy.elite ? POTION_DROP.elite : POTION_DROP.normal;
    if (random(world, 'potionRngState') < potionChance) {
      spawnLoot(world, enemy.x + (random(world, 'potionRngState') - 0.5) * 0.5, enemy.z + (random(world, 'potionRngState') - 0.5) * 0.5, {
        ownerId: player.playerId,
        lootType: 'potion',
      });
    }
  }
}

function killStageEnemy(
  world,
  source,
  enemy,
  damage,
  castId,
  critical = false,
  skillId = 0,
  viewLag = source.viewLag ?? 0,
  viewTick = source.lastInput?.viewTick,
  guarded = false,
  shape = null,
) {
  if (enemy.dead) return;
  enemy.hitCountSinceBlink = (enemy.hitCountSinceBlink ?? 0) + 1;
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.hitFlashTicks = 9;
  if (source.kind === 'player') {
    const dx = enemy.x - source.x;
    const dz = enemy.z - source.z;
    const distance = Math.hypot(dx, dz) || 1;
    moveEntity(world, enemy, dx / distance * 0.18, dz / distance * 0.18);
  }
  emit(world, 'hit', {
    sourceId: source.id,
    targetId: enemy.id,
    damage,
    castId,
    critical,
    skill: skillId,
    viewLag,
    inputSeq: source.lastInput?.seq,
    ...(guarded ? { guarded: true, shape: copyShape(shape) } : {}),
    ...(Number.isSafeInteger(viewTick) ? { viewTick } : {}),
  });
  if (enemy.hp > 0) return;
  enemy.dead = true;
  enemy.deathTicks = 24;
  enemy.attackShape = null;
  enemy.attackPhase = null;
  emit(world, 'death', { entityId: enemy.id, killerId: source.id, castId });
  dropRewards(world, enemy);
  if (
    world.objective?.type === 'hunt'
    && world.objective.targetId === enemy.id
    && world.tick < world.objective.endsTick
  ) completeObjective(world, enemy);
  if (enemy.boss) emit(world, 'bossDefeated', { entityId: enemy.id });
}

export function playerStrike(world, player, shape, motionMult, castId, hitTargets, skillId = undefined, {
  rewind = true,
  maxTargets = Infinity,
  targetEntityId = null,
  slowTicks = 0,
  stunTicks = 0,
  knockback = 0,
  forceCritical = false,
  viewLag = player.viewLag,
  viewTick = player.lastInput?.viewTick,
} = {}) {
  const history = rewind ? enemyHistoryFrame(world, viewLag) : null;
  emit(world, 'strike', {
    sourceId: player.id,
    castId,
    skill: skillId,
    shape: structuredClone(shape),
    viewLag,
    inputSeq: player.lastInput?.seq,
    ...(Number.isSafeInteger(viewTick) ? { viewTick } : {}),
  });
  let candidates = stageActiveEnemies(world)
    .map((enemy) => {
      const historical = history?.enemies.find((entry) => entry.id === enemy.id);
      if (history && (!historical || historical.dead)) return null;
      const target = historical ?? enemy;
      return attackShapeHit(shape, target, target.radius) ? { enemy, target } : null;
    })
    .filter((candidate) => candidate && (targetEntityId === null || candidate.enemy.id === targetEntityId));
  if (Number.isFinite(maxTargets) && shape.type === 'line') {
    candidates.sort((a, b) => {
      const project = ({ target }) => (
        (target.x - shape.originX) * Math.cos(shape.angle) +
        (target.z - shape.originZ) * Math.sin(shape.angle)
      );
      return project(a) - project(b) || a.enemy.id - b.enemy.id;
    });
  }
  let hitCount = 0;
  let counterHealApplied = false;
  for (const { enemy, target } of candidates) {
    if (hitTargets.includes(enemy.id) || enemy.invulnerable || enemy.spawnTicksLeft > 0) continue;
    if (enemy.dead) continue;
    hitTargets.push(enemy.id);
    const critical = forceCritical || random(world) * 100 < player.stats.critChance;
    const skillRank = Number.isInteger(skillId) ? player.masteryRanks?.[skillId] ?? 0 : 0;
    const skillDamageMult = motionMult * (1 + masteryBonus(skillRank).damagePct / 100);
    const rawDamage = calculateDamage(player.stats.attack, skillDamageMult, critical, player.stats.critDamage, enemy.defense ?? 0);
    const sourceX = Number.isFinite(shape.originX) ? shape.originX : player.x;
    const sourceZ = Number.isFinite(shape.originZ) ? shape.originZ : player.z;
    const incomingAngle = Math.atan2(sourceZ - target.z, sourceX - target.x);
    const guarded = enemy.enemyKind === 'shieldbearer'
      && !shieldGuardLowered(world, enemy)
      && Math.abs(angleDifference(incomingAngle, target.facing ?? enemy.facing)) <= Math.PI / 3;
    const damage = guarded ? Math.max(1, Math.round(rawDamage * 0.5)) : rawDamage;
    if (slowTicks > 0) enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, slowTicks);
    killStageEnemy(
      world,
      player,
      enemy,
      damage,
      castId,
      critical,
      skillId ?? 0,
      viewLag,
      viewTick,
      guarded,
      shape,
    );
    if (
      player.evolved
      && player.lineage === 'skeleton_knight'
      && skillId === 'counter'
      && !counterHealApplied
    ) {
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.08));
      counterHealApplied = true;
    }
    if (
      player.evolved
      && player.lineage === 'skeleton_mage'
      && Number.isInteger(skillId)
      && skillId > 0
      && enemy.dead
      && !(player.lichRefundedCastIds ?? []).includes(castId)
    ) {
      const refundedCastIds = player.lichRefundedCastIds ??= [];
      refundedCastIds.push(castId);
      if (refundedCastIds.length > 8) {
        refundedCastIds.splice(0, refundedCastIds.length - 8);
      }
      for (const [id, cooldown] of Object.entries(player.skillCooldowns)) {
        if (Number(id) !== skillId) player.skillCooldowns[id] = Math.max(0, cooldown - 30);
      }
    }
    if (!enemy.dead && stunTicks > 0 && !enemy.boss) {
      enemy.stunnedTicks = Math.max(enemy.stunnedTicks ?? 0, stunTicks);
      enemy.attackPhase = null;
      enemy.attackShape = null;
      enemy.attackRemaining = 0;
      enemy.attackCooldownTicks = Math.max(enemy.attackCooldownTicks ?? 0, stunTicks);
    }
    if (!enemy.dead && knockback > 0) {
      const dx = enemy.x - sourceX;
      const dz = enemy.z - sourceZ;
      const distance = Math.hypot(dx, dz) || 1;
      moveEntity(world, enemy, dx / distance * knockback, dz / distance * knockback);
    }
    const heal = Math.floor(damage * player.stats.lifesteal / 100);
    if (heal) player.hp = Math.min(player.maxHp, player.hp + heal);
    if (!enemy.dead && slowTicks > 0) enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, slowTicks);
    hitCount += 1;
    if (hitCount >= maxTargets) break;
  }
  return hitTargets;
}

function queuePendingImpact(world, impact) {
  const pending = {
    ...impact,
    viewLag: clamp(Math.trunc(impact.viewLag ?? 0), 0, 12),
    shape: copyShape(impact.shape),
  };
  world.pendingImpacts.push(pending);
  emit(world, 'impact', {
    id: pending.id,
    ownerId: pending.ownerId,
    ownerEntityId: pending.ownerEntityId,
    castSeq: pending.castSeq,
    fireTick: world.tick,
    resolveTick: pending.resolveTick,
    endsTick: pending.endsTick,
    hitEvery: pending.hitEvery,
    hitsRemaining: pending.hitsRemaining,
    ...(Number.isSafeInteger(pending.targetEntityId) ? { targetEntityId: pending.targetEntityId } : {}),
    viewLag: pending.viewLag,
    ...(Number.isSafeInteger(pending.viewTick) ? { viewTick: pending.viewTick } : {}),
    shape: copyShape(pending.shape),
    kind: pending.kind,
    sourceX: pending.sourceX,
    sourceZ: pending.sourceZ,
  });
}

function resolvePendingImpacts(world) {
  const remaining = [];
  for (const impact of world.pendingImpacts) {
    if (impact.kind === 'rain') {
      if (world.tick < impact.resolveTick || (world.tick - impact.resolveTick) % impact.hitEvery !== 0) {
        remaining.push(impact);
        continue;
      }
      const player = world.entities.find((entity) => entity.kind === 'player' && entity.playerId === impact.ownerId);
      if (!player || player.dead || player.downed || !player.connected) continue;
      playerStrike(world, player, impact.shape, impact.motionMult, impact.id, [], impact.skillId, {
        viewLag: impact.viewLag,
        viewTick: impact.viewTick,
      });
      impact.hitsRemaining -= 1;
      if (impact.hitsRemaining > 0) remaining.push(impact);
      continue;
    }
    if (impact.kind === 'burn' || impact.kind === 'poison') {
      if (world.tick < impact.resolveTick) {
        remaining.push(impact);
        continue;
      }
      if (world.tick > impact.endsTick) continue;
      const target = impact.kind === 'poison'
        ? world.entities.find((entity) => entity.id === impact.targetEntityId && !entity.dead)
        : null;
      if (impact.kind === 'poison' && !target) continue;
      const elapsed = world.tick - impact.resolveTick;
      if (elapsed > 0 && elapsed % impact.hitEvery === 0) {
        const player = world.entities.find((entity) => entity.kind === 'player' && entity.playerId === impact.ownerId);
        if (player && !player.dead && !player.downed && player.connected) {
          const shape = target
            ? { type: 'circle', originX: target.x, originZ: target.z, radius: impact.radius }
            : impact.shape;
          playerStrike(world, player, shape, impact.motionMult, impact.id, [], impact.skillId, {
            targetEntityId: impact.targetEntityId ?? null,
            viewLag: impact.viewLag,
            viewTick: impact.viewTick,
          });
          if (target) {
            emit(world, 'impact', {
              id: impact.id,
              ownerId: impact.ownerId,
              castSeq: impact.castSeq,
              resolveTick: world.tick,
              targetEntityId: target.id,
              shape: copyShape(shape),
              kind: 'poison-puff',
            });
          }
        }
      }
      if (world.tick < impact.endsTick && (!target || !target.dead)) remaining.push(impact);
      continue;
    }
    if (world.tick < impact.resolveTick) {
      remaining.push(impact);
      continue;
    }
    const player = world.entities.find((entity) => entity.kind === 'player' && entity.playerId === impact.ownerId);
    if (!player || player.dead || player.downed || !player.connected) continue;
    const hitTargets = playerStrike(
      world,
      player,
      impact.shape,
      impact.motionMult,
      impact.id,
      [],
      impact.skillId,
      {
        slowTicks: impact.slowTicks ?? 0,
        stunTicks: impact.stunTicks ?? 0,
        knockback: impact.knockback ?? 0,
        viewLag: impact.viewLag,
        viewTick: impact.viewTick,
      },
    );
    if (impact.kind === 'frost') {
      for (const enemyId of hitTargets) {
        const enemy = world.entities.find((entity) => entity.id === enemyId);
        if (enemy && !enemy.dead) enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, impact.slowTicks);
      }
    }
  }
  world.pendingImpacts = remaining;
}

function familySkillName(player, id) {
  return skillsFor(player.family ?? 'sword', player.lineage)?.[id - 1] ?? null;
}

function skillDuration(name) {
  const skill = SKILLS[name];
  if (name === 'spin') return skill.windupTicks + skill.activeTicks + skill.recoveryTicks;
  if (name === 'guard') return skill.durationTicks;
  return skill.windupTicks ?? skill.dashTicks ?? 1;
}

function startSkillMotion(ctx, player, id, seq, input) {
  const name = familySkillName(player, id);
  const skill = SKILLS[name];
  if (!skill) return null;
  const castId = `${player.playerId}:${seq}`;
  const target = ['rain', 'meteor', 'cursedHands'].includes(name)
    ? aimedPoint(ctx, player, skill.range, skill.fallbackDistance, input)
    : null;
  player.skillCast = {
    id,
    name,
    family: player.family ?? 'sword',
    castId,
    seq,
    startedTick: ctx.tick,
    ticks: skillDuration(name),
    tick: 0,
    hitTargets: [],
    originX: player.x,
    originZ: player.z,
    angle: player.facing,
    targetX: name === 'quake'
      ? player.x + Math.cos(player.facing) * skill.forwardOffset
      : target?.x,
    targetZ: name === 'quake'
      ? player.z + Math.sin(player.facing) * skill.forwardOffset
      : target?.z,
  };
  return {
    entityId: player.id,
    playerId: player.playerId,
    castId,
    skill: id,
    skillKey: name,
    skillName: skill.name,
    family: player.family ?? 'sword',
  };
}

function applyPotion(world, player, seq) {
  if (player.potionTicks > 0) return;
  player.potionTicks = POTION.durationTicks;
  player.potionHealTicks = POTION.durationTicks;
  player.potionHealRemaining = Math.round(player.maxHp * POTION.healFraction);
  world.rewards[player.playerId].potionsUsed += 1;
  emit(world, 'potion', { entityId: player.id, playerId: player.playerId, seq });
}

export function stepPlayerMotion(ctx, player, rawInput) {
  const input = normalizeInput(player, rawInput);
  let pressed = input.buttons & ~player.previousButtons;
  player.previousButtons = input.buttons;
  const counterRequested = Boolean((pressed & BUTTONS.ATTACK) && player.counterReadyTicks > 0);
  if (counterRequested) pressed &= ~(BUTTONS.SKILL1 | BUTTONS.SKILL2 | BUTTONS.SKILL3 | BUTTONS.SKILL4);
  if (counterRequested && player.skillCast) {
    const castId = player.skillCast.castId;
    if (castId && Array.isArray(ctx.pendingImpacts)) {
      ctx.pendingImpacts = ctx.pendingImpacts.filter((impact) => (
        impact.ownerEntityId !== player.id || impact.id !== castId
      ));
    }
    player.skillCast = null;
  }
  player.lastInput = input;
  const viewTick = Number.isSafeInteger(rawInput?.viewTick) ? rawInput.viewTick : undefined;
  player.viewLag = viewTick === undefined
    ? 0
    : clamp((Number.isSafeInteger(ctx.tick) ? ctx.tick : 0) - viewTick, 0, 12);
  const events = [];
  const skillImpacts = [];
  let skillStrike = null;
  const skillStrikes = [];
  let attackStrike = null;
  let counterStrike = null;
  const pendingImpacts = [];
  const shots = [];
  const blinks = [];
  const addSkillStrike = (strike) => {
    skillStrike ??= strike;
    skillStrikes.push(strike);
  };
  const moveX = input.moveX / 127;
  const moveZ = input.moveZ / 127;
  const magnitude = Math.hypot(moveX, moveZ);
  const directionX = magnitude > 1 ? moveX / magnitude : moveX;
  const directionZ = magnitude > 1 ? moveZ / magnitude : moveZ;
  const family = player.family ?? 'sword';
  player.moving = Math.abs(directionX) + Math.abs(directionZ) > 0.01;
  if (player.moving && player.guardTicks <= 0) player.facing = Math.atan2(directionZ, directionX);
  else if (!player.moving) player.facing = angleFromAim(input.aim);
  if (family !== 'sword') {
    if (Number.isFinite(input.ad)) player.facing = angleFromAim(input.aim);
    else {
      const target = pickAimTarget(ctx, player, family === 'crossbow' ? 12 : 8);
      if (target) player.facing = Math.atan2(target.z - player.z, target.x - player.x);
    }
  }

  const skillId = pressed & BUTTONS.SKILL1 ? 1
    : pressed & BUTTONS.SKILL2 ? 2
      : pressed & BUTTONS.SKILL3 ? 3
        : pressed & BUTTONS.SKILL4 ? 4 : 0;
  if (skillId && !(skillId === 4 && player.level < 7) && !player.skillCast && player.skillCooldowns[skillId] === 0) {
    const payload = startSkillMotion(ctx, player, skillId, input.seq, input);
    if (payload) {
      const skillKey = familySkillName(player, skillId);
      const skill = SKILLS[skillKey];
      if (stageActiveEnemies(ctx).some((enemy) => (
        Math.hypot(enemy.x - player.x, enemy.z - player.z) <= 8
      ))) {
        const reward = ctx.rewards[player.playerId];
        reward.skillUses[skillKey] = (reward.skillUses[skillKey] ?? 0) + 1;
      }
      const cooldownBonus = masteryBonus(player.masteryRanks?.[skillId] ?? 0).cooldownPct;
      const cooldownTicks = Math.max(1, Math.round(skill.cooldownTicks * (
        1 - Math.min(60, player.stats.skillCooldownReduction) / 100
      ) * (
        1 - cooldownBonus / 100
      )));
      player.skillCooldowns[skillId] = cooldownTicks;
      events.push({ type: 'skill', payload, cooldownTicks });
      if (skillId === 4 && skillKey !== 'deadBurst') {
        const cast = player.skillCast;
        const shape = {
          type: 'circle',
          originX: cast.targetX,
          originZ: cast.targetZ,
          radius: skill.radius,
        };
        events.push({
          type: 'skillTelegraph',
          payload: {
            castId: cast.castId,
            ownerId: player.playerId,
            skillName: cast.name,
            startTick: ctx.tick,
            resolveTick: ctx.tick + skill.windupTicks - 1,
            shape,
          },
        });
      }
    }
  }
  if ((pressed & BUTTONS.POTION) && player.potions > 0 && player.potionCooldownTicks === 0 && player.potionTicks === 0) {
    player.potions -= 1;
    player.potionCooldownTicks = POTION.cooldownTicks;
    events.push({ type: 'potion', seq: input.seq });
  }

  let bufferedDodgeCreated = false;
  if ((pressed & BUTTONS.DODGE) && player.dodgeCooldownTicks === 0) {
    if (player.skillCast || player.attack?.phase === 'active') {
      player.dodgeBufferTicks = 6;
      bufferedDodgeCreated = true;
    } else {
      if (player.attack?.phase === 'windup') cancelPlayerAttack(ctx, player);
      startPlayerDodge(ctx, player, directionX, directionZ, input, events);
    }
  } else if (
    !(pressed & BUTTONS.DODGE) &&
    player.dodgeBufferTicks > 0 &&
    !bufferedDodgeCreated
  ) {
    if (!player.skillCast && player.attack?.phase !== 'active') {
      player.dodgeBufferTicks = 0;
      if (player.dodgeCooldownTicks === 0) {
        if (player.attack?.phase === 'windup') cancelPlayerAttack(ctx, player);
        startPlayerDodge(ctx, player, directionX, directionZ, input, events);
      }
    } else player.dodgeBufferTicks -= 1;
  }

  const moveSpeed = player.stats.moveSpeed / TICK_HZ;
  if (player.guardTicks > 0) {
    player.guardTicks -= 1;
    player.moving = false;
  }
  if (player.skillCast) {
    const cast = player.skillCast;
    const skill = SKILLS[cast.name];
    cast.tick += 1;
    if (cast.name === 'deadBurst' && cast.tick === 1) {
      const hpCost = Math.max(1, Math.round(player.maxHp * skill.hpCostFraction));
      player.hp = Math.max(1, player.hp - hpCost);
    }
    if (cast.name === 'dash') {
      const stepDistance = skill.dashDistance / skill.dashTicks;
      moveEntity(ctx, player, Math.cos(cast.angle) * stepDistance, Math.sin(cast.angle) * stepDistance);
      addSkillStrike({
        shape: makeLineShape(cast.originX, cast.originZ, cast.angle, skill.length, skill.width),
        motionMult: skill.motionMult,
        castId: cast.castId,
        hitTargets: cast.hitTargets,
        viewTick: input.viewTick,
        skillId: cast.id,
      });
    } else if (cast.name === 'vault') {
      if (cast.tick === 1) player.iFrames = Math.max(player.iFrames, skill.iframeTicks);
      moveEntity(
        ctx,
        player,
        -Math.cos(cast.angle) * skill.retreatDistance / skill.dashTicks,
        -Math.sin(cast.angle) * skill.retreatDistance / skill.dashTicks,
      );
      if (cast.tick === skill.dashTicks) {
        const shape = makeLineShape(player.x, player.z, cast.angle, 9, 0.5);
        attackStrike = {
          shape,
          motionMult: skill.motionMult,
          castId: cast.castId,
          hitTargets: [],
          maxTargets: 1,
          viewTick: input.viewTick,
          skillId: cast.id,
        };
        shots.push({ ownerId: player.playerId, x: player.x, z: player.z, angle: cast.angle, length: 9, castSeq: cast.seq });
      }
    } else if (cast.name === 'blink' && cast.tick === 1) {
      const from = { x: player.x, z: player.z };
      const angle = player.moving ? Math.atan2(directionZ, directionX) : cast.angle;
      player.iFrames = Math.max(player.iFrames, skill.iframeTicks);
      const steps = Math.ceil(skill.distance / 0.5);
      const stepDistance = skill.distance / steps;
      for (let index = 0; index < steps; index += 1) {
        moveEntity(ctx, player, Math.cos(angle) * stepDistance, Math.sin(angle) * stepDistance);
      }
      blinks.push({ ownerId: player.playerId, castSeq: cast.seq, from, to: { x: player.x, z: player.z } });
    }
    if (cast.name === 'quake' && cast.tick === skill.windupTicks) {
      const shape = {
        type: 'circle',
        originX: cast.targetX,
        originZ: cast.targetZ,
        radius: skill.radius,
      };
      addSkillStrike({
        shape,
        motionMult: skill.motionMult,
        castId: cast.castId,
        hitTargets: cast.hitTargets,
        viewTick: input.viewTick,
        skillId: cast.id,
        stunTicks: skill.stunTicks,
      });
      skillImpacts.push({ castSeq: cast.seq, castId: cast.castId, shape, kind: 'quake' });
    } else if (cast.name === 'deadBurst' && cast.tick === skill.windupTicks) {
      const shape = {
        type: 'circle',
        originX: player.x,
        originZ: player.z,
        radius: skill.radius,
      };
      pendingImpacts.push({
        id: cast.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: cast.seq,
        resolveTick: ctx.tick,
        shape,
        motionMult: skill.motionMult,
        knockback: skill.knockback,
        kind: 'deadBurst',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        skillId: cast.id,
        sourceX: player.x,
        sourceZ: player.z,
      });
    } else if (cast.name === 'cursedHands' && cast.tick === skill.windupTicks) {
      const shape = {
        type: 'circle',
        originX: cast.targetX,
        originZ: cast.targetZ,
        radius: skill.radius,
      };
      attackStrike = {
        shape,
        motionMult: skill.motionMult,
        castId: cast.castId,
        hitTargets: cast.hitTargets,
        viewTick: input.viewTick,
        skillId: cast.id,
        rootTicks: skill.rootTicks,
        bossRootTicks: skill.bossRootTicks,
      };
      skillImpacts.push({
        castSeq: cast.seq,
        castId: cast.castId,
        shape,
        kind: 'cursedHands',
        endsTick: ctx.tick + skill.rootTicks,
      });
    } else if (cast.name === 'rain' && cast.tick === skill.windupTicks) {
      pendingImpacts.push({
        id: cast.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: cast.seq,
        resolveTick: ctx.tick,
        endsTick: ctx.tick + skill.hitEvery * (skill.hitCount - 1),
        hitEvery: skill.hitEvery,
        hitsRemaining: skill.hitCount,
        shape: { type: 'circle', originX: cast.targetX, originZ: cast.targetZ, radius: skill.radius },
        motionMult: skill.motionMult,
        kind: 'rain',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        skillId: cast.id,
        sourceX: player.x,
        sourceZ: player.z,
      });
    } else if (cast.name === 'meteor' && cast.tick === skill.windupTicks) {
      pendingImpacts.push({
        id: cast.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: cast.seq,
        resolveTick: ctx.tick,
        shape: { type: 'circle', originX: cast.targetX, originZ: cast.targetZ, radius: skill.radius },
        motionMult: skill.motionMult,
        knockback: skill.knockback,
        kind: 'meteor',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        skillId: cast.id,
        sourceX: player.x,
        sourceZ: player.z,
      });
    }
    if (cast.name === 'spin' && cast.tick >= skill.windupTicks && cast.tick < skill.windupTicks + skill.activeTicks) {
      addSkillStrike({
        shape: { type: 'circle', originX: cast.originX, originZ: cast.originZ, radius: skill.range },
        motionMult: skill.motionMult,
        castId: cast.castId,
        hitTargets: cast.hitTargets,
        viewTick: input.viewTick,
        skillId: cast.id,
      });
    } else if (cast.name === 'guard' && cast.tick === 1) {
      player.guardTicks = skill.durationTicks;
    } else if (cast.name === 'pierce' && cast.tick === skill.windupTicks) {
      const shape = makeLineShape(cast.originX, cast.originZ, cast.angle, skill.length, skill.width);
      addSkillStrike({ shape, motionMult: skill.motionMult, castId: cast.castId, hitTargets: cast.hitTargets, viewTick: input.viewTick, skillId: cast.id });
      shots.push({ ownerId: player.playerId, x: cast.originX, z: cast.originZ, angle: cast.angle, length: skill.length, castSeq: cast.seq });
    } else if (cast.name === 'volley' && cast.tick === skill.windupTicks) {
      for (let lineIndex = 0; lineIndex < skill.count; lineIndex += 1) {
        const offset = -skill.spread + lineIndex * (skill.spread * 2 / (skill.count - 1));
        const angle = cast.angle + offset;
        const shape = makeLineShape(cast.originX, cast.originZ, angle, skill.length, skill.width);
        addSkillStrike({ shape, motionMult: skill.motionMult, castId: `${cast.castId}:${lineIndex}`, hitTargets: [], viewTick: input.viewTick, skillId: cast.id });
        shots.push({ ownerId: player.playerId, x: cast.originX, z: cast.originZ, angle, length: skill.length, castSeq: cast.seq, lineIndex });
      }
    } else if (cast.name === 'poisonArrow' && cast.tick === skill.windupTicks) {
      const shape = makeLineShape(cast.originX, cast.originZ, cast.angle, skill.length, skill.width);
      attackStrike = {
        shape,
        motionMult: skill.motionMult,
        castId: cast.castId,
        hitTargets: cast.hitTargets,
        maxTargets: 1,
        viewTick: input.viewTick,
        skillId: cast.id,
        poison: {
          ticks: skill.poisonTicks,
          hitEvery: skill.poisonEvery,
          motionMult: skill.poisonMotionMult,
          castSeq: cast.seq,
        },
      };
      shots.push({
        ownerId: player.playerId,
        x: cast.originX,
        z: cast.originZ,
        angle: cast.angle,
        length: skill.length,
        castSeq: cast.seq,
        skillKey: cast.name,
      });
    } else if (cast.name === 'flame' && cast.tick === skill.windupTicks) {
      const point = aimedPoint(ctx, player, skill.range, 6, input);
      pendingImpacts.push({
        id: cast.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: cast.seq,
        resolveTick: ctx.tick + skill.windupTicks,
        shape: { type: 'circle', originX: point.x, originZ: point.z, radius: skill.radius },
        motionMult: skill.motionMult,
        kind: 'burn',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        hitEvery: skill.hitEvery,
        endsTick: ctx.tick + skill.windupTicks + skill.burnTicks,
        skillId: cast.id,
        sourceX: player.x,
        sourceZ: player.z,
      });
    } else if (cast.name === 'frost' && cast.tick === skill.windupTicks) {
      pendingImpacts.push({
        id: cast.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: cast.seq,
        resolveTick: ctx.tick + skill.windupTicks,
        shape: { type: 'circle', originX: player.x, originZ: player.z, radius: skill.radius },
        motionMult: skill.motionMult,
        kind: 'frost',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        slowTicks: skill.slowTicks,
        skillId: cast.id,
        sourceX: player.x,
        sourceZ: player.z,
      });
    }
    if (cast.tick >= cast.ticks) player.skillCast = null;
  } else if (!player.skillCast) {
    if (player.dodgeTicks > 0) moveEntity(ctx, player, player.dodgeVectorX * 8.5 / TICK_HZ, player.dodgeVectorZ * 8.5 / TICK_HZ);
    else moveEntity(ctx, player, directionX * moveSpeed, directionZ * moveSpeed);
  }

  if (counterRequested) {
    counterStrike = startPlayerCounter(ctx, player, input);
    if (counterStrike && player.stats.counterFireField) {
      const flame = SKILLS.flame;
      pendingImpacts.push({
        id: `${counterStrike.castId}:fire`,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: input.seq,
        resolveTick: ctx.tick + 1,
        shape: {
          type: 'circle',
          originX: counterStrike.fireFieldPoint.x,
          originZ: counterStrike.fireFieldPoint.z,
          radius: flame.radius,
        },
        motionMult: flame.motionMult * 0.5,
        kind: 'burn',
        viewLag: player.viewLag,
        viewTick: input.viewTick,
        hitEvery: flame.hitEvery,
        endsTick: ctx.tick + 1 + 2 * TICK_HZ,
        sourceX: player.x,
        sourceZ: player.z,
      });
    }
  } else if (pressed & BUTTONS.ATTACK) {
    if (!player.attack) events.push({
      type: 'attack',
      payload: startPlayerAttackMotion(player, 1, input.seq),
    });
    else queueCombo(player, input.seq);
  }
  if (player.attack) {
    const attack = player.attack;
    const timeline = comboTimeline(player, attack.step);
    if (attack.phase === 'active') {
      if (family === 'sword') {
        const shape = createAttackShape(player, player.facing, timeline.range, timeline.halfAngle);
        attackStrike = {
          shape: { ...shape, type: 'sector' },
          motionMult: [1, 1.1, 1.8][attack.step - 1],
          castId: attack.castId,
          hitTargets: attack.hitTargets,
          viewTick: input.viewTick,
        };
      } else if (family === 'crossbow') {
        const piercing = attack.piercing ?? player.pierceShotsRemaining > 0;
        attackStrike = {
          shape: makeLineShape(player.x, player.z, player.facing, timeline.range, timeline.width),
          motionMult: [0.6, 0.6, 0.95][attack.step - 1],
          castId: attack.castId,
          hitTargets: attack.hitTargets,
          maxTargets: piercing ? Infinity : 1,
          viewTick: input.viewTick,
        };
        if (!attack.fired) {
          attack.piercing = piercing;
          shots.push({ ownerId: player.playerId, x: player.x, z: player.z, angle: player.facing, length: timeline.range, castSeq: attack.seq });
          attack.fired = true;
          if (piercing) player.pierceShotsRemaining = Math.max(0, player.pierceShotsRemaining - 1);
        }
      } else if (!attack.fired) {
        const point = aimedPoint(ctx, player, timeline.range, 6, input);
        const radius = [1, 1, 1.6][attack.step - 1];
        pendingImpacts.push({
          id: attack.castId,
          ownerId: player.playerId,
          ownerEntityId: player.id,
          castSeq: attack.seq,
          resolveTick: ctx.tick + 7,
          shape: { type: 'circle', originX: point.x, originZ: point.z, radius },
          motionMult: [0.8, 0.8, 1.3][attack.step - 1],
          kind: 'staff-basic',
          viewLag: player.viewLag,
          viewTick: input.viewTick,
          skillId: 0,
          sourceX: player.x,
          sourceZ: player.z,
        });
        attack.fired = true;
      }
    }
    attack.phaseTick += 1;
    const phaseLength = attack.phase === 'windup'
      ? timeline.windupTicks
      : attack.phase === 'active'
        ? timeline.activeTicks
        : timeline.recoveryTicks;
    if (attack.phaseTick >= phaseLength) {
      if (attack.phase === 'windup') {
        attack.phase = 'active';
        attack.phaseTick = 0;
      } else if (attack.phase === 'active') {
        attack.phase = 'recovery';
        attack.phaseTick = 0;
        attack.shape = null;
      } else if (attack.queued && attack.step < COMBO_TIMELINES.length) {
        events.push({
          type: 'attack',
          payload: startPlayerAttackMotion(player, attack.step + 1, attack.queuedSeq),
        });
      } else player.attack = null;
    }
  }

  player.dodgeTicks = Math.max(0, player.dodgeTicks - 1);
  player.iFrames = Math.max(0, player.iFrames - 1);
  player.dodgeCooldownTicks = Math.max(0, player.dodgeCooldownTicks - 1);
  player.hitFlashTicks = Math.max(0, player.hitFlashTicks - 1);
  player.potionCooldownTicks = Math.max(0, player.potionCooldownTicks - 1);
  player.counterReadyTicks = Math.max(0, player.counterReadyTicks - (counterStrike ? 0 : 1));
  for (const id of [1, 2, 3, 4]) player.skillCooldowns[id] = Math.max(0, player.skillCooldowns[id] - 1);
  let potionHeal = 0;
  if (player.potionTicks > 0) {
    potionHeal = Math.ceil(player.potionHealRemaining / player.potionHealTicks);
    player.potionHealRemaining = Math.max(0, player.potionHealRemaining - potionHeal);
    player.potionHealTicks -= 1;
    player.potionTicks -= 1;
  }
  return { input, pressed, events, skillStrike, skillStrikes, skillImpacts, attackStrike, counterStrike, pendingImpacts, shots, blinks, potionHeal };
}

function startPlayerDodge(ctx, player, directionX, directionZ, input, events) {
  player.dodgeVectorX = player.moving ? directionX : Math.cos(player.facing);
  player.dodgeVectorZ = player.moving ? directionZ : Math.sin(player.facing);
  player.dodgeTicks = DODGE_DURATION_TICKS;
  player.iFrames = DODGE_IFRAME_TICKS;
  const cooldownTicks = Math.round(DODGE_COOLDOWN_TICKS * (1 - player.stats.dodgeCooldownReduction / 100));
  player.dodgeCooldownTicks = cooldownTicks;
  player.dodgeCooldownRefundTicks = Math.ceil(cooldownTicks / 2);
  player.dodgeStartTick = ctx.tick;
  player.perfectPaid = false;
  player.dodgeBufferTicks = 0;
  events.push({ type: 'dodge', cooldownTicks, seq: input.seq });
}

function cancelPlayerAttack(world, player) {
  const castId = player.attack?.castId;
  if (castId && Array.isArray(world.pendingImpacts)) {
    world.pendingImpacts = world.pendingImpacts.filter((impact) => (
      impact.ownerEntityId !== player.id || impact.id !== castId
    ));
  }
  player.attack = null;
}

function startPlayerCounter(world, player, input) {
  const attacker = world.entities.find((entity) => entity.id === player.counterAttackerId && !entity.dead);
  const dx = attacker ? attacker.x - player.x : 0;
  const dz = attacker ? attacker.z - player.z : 0;
  const angle = attacker && Math.hypot(dx, dz) > 0.0001
    ? Math.atan2(dz, dx)
    : player.facing;
  const castId = `${player.playerId}:${input.seq}`;
  const hitTargets = [];
  let shape;
  let motionMult;
  let slowTicks = 0;
  const fireFieldPoint = attacker
    ? { x: attacker.x, z: attacker.z }
    : { x: player.x + Math.cos(angle) * 2.8, z: player.z + Math.sin(angle) * 2.8 };
  if (player.family === 'sword') {
    shape = makeLineShape(player.x, player.z, angle, 3.5, 1.6);
    motionMult = 1.8;
    player.facing = angle;
    player.iFrames = Math.max(player.iFrames, 4);
  } else if (player.family === 'crossbow') {
    shape = makeLineShape(player.x, player.z, angle, 12, 0.8);
    motionMult = 2.0;
    player.facing = angle;
  } else {
    shape = { type: 'circle', originX: player.x, originZ: player.z, radius: 2.8 };
    motionMult = 1.6;
    slowTicks = 45;
  }
  player.counterReadyTicks = 0;
  player.counterAttackerId = null;
  cancelPlayerAttack(world, player);
  return {
    shape,
    motionMult: motionMult * (1 + (player.stats.counterDamagePct ?? 0) / 100),
    castId,
    hitTargets,
    skillId: 'counter',
    slowTicks,
    fireFieldPoint,
    viewTick: input.viewTick,
    payload: {
      entityId: player.id,
      playerId: player.playerId,
      castId,
      family: player.family,
      skillId: 'counter',
      angle,
      shape: copyShape(shape),
    },
  };
}

function advanceStagePlayer(world, player, rawInput) {
  const inputs = Array.isArray(rawInput) ? rawInput : rawInput == null ? [] : [rawInput];
  if (!inputs.length && !world.inputDriven) inputs.push(null);
  for (const input of inputs) {
    if (player.downed || player.dead || !player.connected) continue;
    const motion = stepPlayerMotion(world, player, input);
    for (const event of motion.events) {
      if (event.type === 'skill') emit(world, 'cast', event.payload);
      else if (event.type === 'skillTelegraph') emit(world, 'skillTelegraph', event.payload);
      else if (event.type === 'dodge') emit(world, 'dodge', { entityId: player.id, playerId: player.playerId });
      else if (event.type === 'potion') applyPotion(world, player, event.seq);
      else emit(world, 'cast', event.payload);
    }
    for (const impact of motion.pendingImpacts) queuePendingImpact(world, impact);
    for (const shot of motion.shots) emit(world, 'shot', shot);
    for (const blink of motion.blinks) emit(world, 'blink', blink);
    const skillStrikes = motion.skillStrikes.length ? motion.skillStrikes : motion.skillStrike ? [motion.skillStrike] : [];
    for (const strike of skillStrikes) {
      playerStrike(world, player, strike.shape, strike.motionMult, strike.castId, strike.hitTargets, strike.skillId, {
        maxTargets: strike.maxTargets,
        stunTicks: strike.stunTicks,
        knockback: strike.knockback,
        viewLag: player.viewLag,
        viewTick: strike.viewTick ?? motion.input.viewTick,
      });
    }
    for (const impact of motion.skillImpacts) {
      emit(world, 'impact', {
        id: impact.castId,
        ownerId: player.playerId,
        ownerEntityId: player.id,
        castSeq: impact.castSeq,
        fireTick: world.tick,
        resolveTick: world.tick,
        ...(Number.isSafeInteger(impact.endsTick) ? { endsTick: impact.endsTick } : {}),
        shape: impact.shape,
        kind: impact.kind,
      });
    }
    if (motion.counterStrike) {
      const strike = motion.counterStrike;
      emit(world, 'cast', strike.payload);
      playerStrike(world, player, strike.shape, strike.motionMult, strike.castId, strike.hitTargets, strike.skillId, {
        slowTicks: strike.slowTicks,
        forceCritical: true,
        viewLag: player.viewLag,
        viewTick: strike.viewTick ?? motion.input.viewTick,
      });
    }
    if (motion.attackStrike) {
      const strike = motion.attackStrike;
      const hitTargets = playerStrike(world, player, strike.shape, strike.motionMult, strike.castId, strike.hitTargets, strike.skillId, {
        maxTargets: strike.maxTargets,
        viewLag: player.viewLag,
        viewTick: strike.viewTick ?? motion.input.viewTick,
      });
      for (const enemyId of hitTargets) {
        const enemy = world.entities.find((entity) => entity.id === enemyId);
        if (!enemy || enemy.dead) continue;
        if (strike.poison) {
          world.pendingImpacts = world.pendingImpacts.filter((impact) => !(
            impact.kind === 'poison'
            && impact.ownerId === player.playerId
            && impact.targetEntityId === enemy.id
          ));
          queuePendingImpact(world, {
            id: strike.castId,
            ownerId: player.playerId,
            ownerEntityId: player.id,
            castSeq: strike.poison.castSeq,
            resolveTick: world.tick,
            endsTick: world.tick + strike.poison.ticks,
            hitEvery: strike.poison.hitEvery,
            targetEntityId: enemy.id,
            radius: enemy.radius ?? 0.3,
            shape: { type: 'circle', originX: enemy.x, originZ: enemy.z, radius: enemy.radius ?? 0.3 },
            motionMult: strike.poison.motionMult,
            kind: 'poison',
            skillId: strike.skillId,
            viewLag: player.viewLag,
            viewTick: strike.viewTick ?? motion.input.viewTick,
            sourceX: player.x,
            sourceZ: player.z,
          });
        }
        if (strike.rootTicks) {
          const rootTicks = enemy.boss ? strike.bossRootTicks : strike.rootTicks;
          enemy.rootedTicks = Math.max(enemy.rootedTicks ?? 0, rootTicks);
        }
      }
    }
    if (motion.potionHeal > 0) {
      player.hp = Math.min(player.maxHp, player.hp + motion.potionHeal);
    }
  }
}

function damagePlayerM1(world, enemy, player, shape, motionMult = 1, knockback = 0) {
  if (player.dead || player.iFrames > 0) return false;
  const incomingAngle = Math.atan2(shape.originZ - player.z, shape.originX - player.x);
  const facingAngle = angleDifference(incomingAngle, player.facing);
  const guarding = player.guardTicks > 0 && Math.abs(facingAngle) <= SKILLS.guard.halfAngle;
  const perfect = guarding && player.guardTicks >= SKILLS.guard.durationTicks - SKILLS.guard.perfectTicks + 1;
  let damage = calculateDamage(enemy.attack, motionMult, false, 1, player.stats.defense);
  if (guarding) {
    damage = Math.max(1, Math.round(damage * SKILLS.guard.damageMultiplier));
    if (perfect) {
      enemy.stunnedTicks = SKILLS.guard.stunTicks;
      enemy.attackPhase = null;
      enemy.attackShape = null;
      enemy.attackCooldownTicks = SKILLS.guard.stunTicks;
      emit(world, 'perfectBlock', { entityId: player.id, attackerId: enemy.id });
    }
  }
  player.hp = Math.max(0, player.hp - damage);
  player.hitFlashTicks = 8;
  if (knockback > 0 && player.hp > 0) {
    const distance = Math.hypot(player.x - enemy.x, player.z - enemy.z) || 1;
    moveEntity(world, player, (player.x - enemy.x) / distance * knockback, (player.z - enemy.z) / distance * knockback);
  }
  emit(world, 'hit', { sourceId: enemy.id, targetId: player.id, damage, blocked: guarding, shape });
  if (player.hp === 0) {
    if (player.boneRevivalReady) {
      player.boneRevivalReady = false;
      player.hp = Math.round(player.maxHp * 0.3);
      player.iFrames = Math.max(player.iFrames ?? 0, 45);
      player.attack = null;
      player.skillCast = null;
      emit(world, 'boneRevival', { entityId: player.id, playerId: player.playerId });
      return true;
    }
    if (world.partySize > 1) {
      player.downed = true;
      player.reviveProgress = 0;
      player.attack = null;
      player.skillCast = null;
      player.dodgeTicks = 0;
      emit(world, 'downed', { entityId: player.id, playerId: player.playerId });
    } else {
      player.dead = true;
      emit(world, 'death', { entityId: player.id, playerId: player.playerId });
      finishStage(world, 'death');
    }
  }
  return true;
}

function beginEnemyTelegraph(world, enemy, target, shape, pattern, windupTicks) {
  enemy.attackPhase = 'windup';
  enemy.attackRemaining = windupTicks;
  enemy.attackWindupTicks = windupTicks;
  enemy.attackShape = shape;
  enemy.attackPattern = pattern;
  enemy.attackTargetId = target.id;
  enemy.attackHit = false;
  emit(world, 'telegraph', { entityId: enemy.id, shape, pattern });
}

function bossWindup(base, phaseTwo, phaseTwoTicks = Math.floor(base * 0.8)) {
  return phaseTwo ? Math.max(12, phaseTwoTicks) : base;
}

function blinkDestination(world, boss, players, minimumDistance) {
  const room = world.arena.rooms[world.roomIndex];
  if (!room) return null;
  const living = players.filter((player) => !player.dead && !player.downed);
  const obstacles = world.arena.obstacles.filter((obstacle) => obstacle.roomId === room.id && !obstacle.doorId);
  const gridSize = 0.5;
  const minGridX = Math.ceil((-world.arena.width / 2 + 1) / gridSize);
  const maxGridX = Math.floor((world.arena.width / 2 - 1) / gridSize);
  const minGridZ = Math.ceil((room.centerZ - 9) / gridSize);
  const maxGridZ = Math.floor((room.centerZ + 9) / gridSize);
  const isClear = (gridX, gridZ) => {
    if (gridX < minGridX || gridX > maxGridX || gridZ < minGridZ || gridZ > maxGridZ) return false;
    const x = gridX * gridSize;
    const z = gridZ * gridSize;
    return !obstacles.some((obstacle) => obstacle.type === 'circle'
      ? Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + boss.radius
      : Math.abs(x - obstacle.x) < obstacle.width / 2 + boss.radius
        && Math.abs(z - obstacle.z) < obstacle.depth / 2 + boss.radius);
  };
  const startX = Math.round(boss.x / gridSize);
  const startZ = Math.round(boss.z / gridSize);
  if (!isClear(startX, startZ) || !living.length) return null;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const visited = new Set([`${startX},${startZ}`]);
  const queue = [[startX, startZ]];
  let best = null;
  for (let head = 0; head < queue.length; head += 1) {
    const [gridX, gridZ] = queue[head];
    const x = gridX * gridSize;
    const z = gridZ * gridSize;
    const distance = Math.min(...living.map((player) => Math.hypot(x - player.x, z - player.z)));
    if (distance >= minimumDistance && (!best || distance > best.distance)) best = { x, z, distance };
    for (const [dx, dz] of directions) {
      const nextX = gridX + dx;
      const nextZ = gridZ + dz;
      const key = `${nextX},${nextZ}`;
      if (visited.has(key) || !isClear(nextX, nextZ)) continue;
      if (dx && dz && (!isClear(gridX + dx, gridZ) || !isClear(gridX, gridZ + dz))) continue;
      visited.add(key);
      queue.push([nextX, nextZ]);
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

function startAshwardenPattern(world, boss, target, players) {
  const patterns = ENEMIES.ashwarden.patterns;
  const spear = patterns['bone-spear'];
  const phaseTwo = boss.hp / boss.maxHp <= 0.5;
  const distance = Math.hypot(target.x - boss.x, target.z - boss.z);
  const summons = world.entities.filter((entity) => entity.kind === 'enemy' && !entity.dead && entity.summonedBy === boss.id);
  const blink = boss.hitCountSinceBlink >= patterns['blink-away'].hitThreshold
    || world.tick - boss.lastBlinkTick >= patterns['blink-away'].tickInterval;
  const pattern = blink ? 'blink-away'
    : distance > spear.minTargetDistance && boss.boneSpearCooldownTicks === 0 ? 'bone-spear'
      : boss.attackPatternIndex++ % 2 === 0 && !summons.length ? 'summon-wave' : 'ash-rain';
  const angle = Math.atan2(target.z - boss.z, target.x - boss.x);
  boss.facing = angle;
  if (pattern === 'bone-spear') {
    boss.boneSpearCooldownTicks = spear.cooldownTicks;
    beginEnemyTelegraph(world, boss, target, makeLineShape(boss.x, boss.z, angle, spear.length, spear.width),
      pattern, bossWindup(spear.windupTicks, phaseTwo, spear.phaseTwoWindupTicks));
  } else if (pattern === 'summon-wave') {
    beginEnemyTelegraph(world, boss, target, { type: 'circle', originX: boss.x, originZ: boss.z, radius: 1.1 },
      pattern, bossWindup(patterns[pattern].windupTicks, phaseTwo));
  } else if (pattern === 'blink-away') {
    beginEnemyTelegraph(world, boss, target, { type: 'circle', originX: boss.x, originZ: boss.z, radius: 1.2 },
      pattern, patterns[pattern].windupTicks);
  } else {
    const circles = players.filter((player) => !player.dead && !player.downed)
      .map((player) => ({ x: player.x, z: player.z, radius: patterns[pattern].radius }));
    const randomCount = patterns[pattern].randomCircles + (phaseTwo ? patterns[pattern].phaseTwoExtra : 0);
    for (let index = 0; index < randomCount; index += 1) {
      circles.push({
        x: -world.arena.width / 2 + 1 + random(world) * (world.arena.width - 2),
        z: world.arena.rooms[world.roomIndex].centerZ - 9 + random(world) * 18,
        radius: patterns[pattern].radius,
      });
    }
    beginEnemyTelegraph(world, boss, target, { type: 'circles', circles }, pattern,
      bossWindup(patterns[pattern].windupTicks, phaseTwo));
  }
}

function maybeBossSummon(world, boss) {
  for (const [threshold, name] of [[0.66, '66'], [0.33, '33']]) {
    if (boss.hp / boss.maxHp > threshold || world.bossThresholds[name]) continue;
    world.bossThresholds[name] = true;
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const summon = spawnStageEnemy(world, 'minion', index, false);
      summon.x = boss.x + Math.cos(angle) * 2.1;
      summon.z = boss.z + Math.sin(angle) * 2.1;
      summon.currentRoomId = boss.currentRoomId;
    }
    emit(world, 'bossSummon', { entityId: boss.id, count: 3, threshold: Number(threshold) });
  }
}

function startBossPattern(world, boss, target) {
  if (boss.enemyKind === 'ashwarden') {
    startAshwardenPattern(world, boss, target, stagePlayers(world));
    return;
  }
  if (boss.enemyKind === 'skeletonking') {
    startSkeletonKingPattern(world, boss, target);
    return;
  }
  const phaseTwo = boss.hp / boss.maxHp < 0.5;
  const patterns = phaseTwo ? ['combo', 'charge', 'slam', 'circles'] : ['combo', 'charge', 'slam'];
  const selectedPattern = patterns[boss.attackPatternIndex % patterns.length];
  boss.attackPatternIndex += 1;
  const rule = ENEMIES.commander.boneSpear;
  const distance = Math.hypot(target.x - boss.x, target.z - boss.z);
  const pattern = distance > rule.minTargetDistance && boss.boneSpearCooldownTicks === 0
    ? 'bone-spear'
    : selectedPattern;
  const angle = Math.atan2(target.z - boss.z, target.x - boss.x);
  boss.facing = angle;
  if (pattern === 'bone-spear') {
    boss.boneSpearCooldownTicks = rule.cooldownTicks;
    beginEnemyTelegraph(
      world,
      boss,
      target,
      makeLineShape(boss.x, boss.z, angle, rule.length, rule.width),
      pattern,
      bossWindup(rule.windupTicks, phaseTwo, rule.phaseTwoWindupTicks),
    );
  } else if (pattern === 'combo') {
    boss.comboSwing = 0;
    beginEnemyTelegraph(world, boss, target, { type: 'sector', originX: boss.x, originZ: boss.z, angle, range: 2.6, halfAngle: 0.82 }, pattern, bossWindup([18, 12, 12][0], phaseTwo));
  } else if (pattern === 'charge') {
    boss.chargeStartX = boss.x;
    boss.chargeStartZ = boss.z;
    boss.chargeAngle = angle;
    boss.lineTravelled = 0;
    beginEnemyTelegraph(world, boss, target, makeLineShape(boss.x, boss.z, angle, 9, 1.6), pattern, bossWindup(27, phaseTwo));
  } else if (pattern === 'slam') {
    beginEnemyTelegraph(world, boss, target, { type: 'circle', originX: boss.x, originZ: boss.z, radius: 3.5 }, pattern, bossWindup(30, phaseTwo));
  } else {
    const circles = [];
    for (let index = 0; index < 5; index += 1) {
      const angleOffset = Math.PI * 2 * index / 5;
      circles.push({
        x: target.x + Math.cos(angleOffset) * (index ? 1.9 : 0),
        z: target.z + Math.sin(angleOffset) * (index ? 1.9 : 0),
        radius: 1.3,
      });
    }
    beginEnemyTelegraph(world, boss, target, { type: 'circles', circles }, pattern, bossWindup(24, phaseTwo));
  }
}

function startSkeletonKingPattern(world, boss, target) {
  const patterns = ENEMIES.skeletonking.patterns;
  const phaseTwo = boss.hp / boss.maxHp <= 0.5;
  const distance = Math.hypot(target.x - boss.x, target.z - boss.z);
  const livingSummons = world.entities.filter((entity) => (
    entity.kind === 'enemy' && !entity.dead && entity.summonedBy === boss.id
  ));
  const cycle = phaseTwo
    ? ['cleave', 'royal-nova', 'summon-wave', 'grave-rise']
    : ['cleave', 'royal-nova', 'summon-wave'];
  let pattern = cycle[boss.attackPatternIndex++ % cycle.length];
  if (pattern === 'summon-wave' && livingSummons.length) pattern = phaseTwo ? 'grave-rise' : 'royal-nova';
  const spear = patterns['bone-spear'];
  if (distance > spear.minTargetDistance && boss.boneSpearCooldownTicks === 0) pattern = 'bone-spear';
  const angle = Math.atan2(target.z - boss.z, target.x - boss.x);
  boss.facing = angle;
  if (pattern === 'cleave') {
    beginEnemyTelegraph(world, boss, target, {
      type: 'sector',
      originX: boss.x,
      originZ: boss.z,
      angle,
      range: patterns.cleave.range,
      halfAngle: patterns.cleave.halfAngle,
    }, pattern, bossWindup(patterns.cleave.windupTicks, phaseTwo));
  } else if (pattern === 'royal-nova') {
    beginEnemyTelegraph(
      world,
      boss,
      target,
      makeAnnulusShape(boss.x, boss.z, patterns['royal-nova'].innerRadius, patterns['royal-nova'].outerRadius),
      pattern,
      bossWindup(patterns['royal-nova'].windupTicks, phaseTwo),
    );
  } else if (pattern === 'summon-wave') {
    beginEnemyTelegraph(world, boss, target, { type: 'circle', originX: boss.x, originZ: boss.z, radius: 1.1 },
      pattern, bossWindup(patterns['summon-wave'].windupTicks, phaseTwo));
  } else if (pattern === 'bone-spear') {
    boss.boneSpearCooldownTicks = spear.cooldownTicks;
    beginEnemyTelegraph(
      world,
      boss,
      target,
      makeLineShape(boss.x, boss.z, angle, spear.length, spear.width),
      pattern,
      bossWindup(spear.windupTicks, phaseTwo, spear.phaseTwoWindupTicks),
    );
  } else {
    const livingPlayers = stagePlayers(world).filter((player) => !player.dead && !player.downed);
    const circles = livingPlayers.map((player) => ({ x: player.x, z: player.z, radius: patterns['grave-rise'].radius }));
    for (let index = 0; index < patterns['grave-rise'].randomCircles; index += 1) {
      circles.push({
        x: -world.arena.width / 2 + 1 + random(world) * (world.arena.width - 2),
        z: world.arena.rooms[world.roomIndex].centerZ - 9 + random(world) * 18,
        radius: patterns['grave-rise'].radius,
      });
    }
    beginEnemyTelegraph(
      world,
      boss,
      target,
      { type: 'circles', circles },
      pattern,
      bossWindup(patterns['grave-rise'].windupTicks, phaseTwo),
    );
  }
}

function activeEnemyAttack(world, enemy, target) {
  if (['summon', 'summon-wave', 'blink-away'].includes(enemy.attackPattern)) return;
  if (
    enemy.enemyKind === 'skeletonking'
    && ['cleave', 'royal-nova', 'grave-rise'].includes(enemy.attackPattern)
  ) {
    const hitPlayers = stagePlayers(world).filter((player) => (
      !player.dead && !player.downed && attackShapeHit(enemy.attackShape, player, player.radius)
    ));
    const wardHit = enemy.objectiveTarget
      ? damageWard(world, enemy, { shape: enemy.attackShape })
      : false;
    if (!hitPlayers.length && !wardHit) return;
    enemy.attackHit = true;
    for (const player of hitPlayers) queueEnemyHit(world, enemy, player, enemy.attackShape);
    return;
  }
  if (enemy.attackPattern === 'ash-rain') {
    const hitPlayers = stagePlayers(world).filter((player) => (
      !player.dead && !player.downed && attackShapeHit(enemy.attackShape, player, player.radius)
    ));
    const wardHit = enemy.objectiveTarget
      ? damageWard(world, enemy, { shape: enemy.attackShape })
      : false;
    if (!hitPlayers.length && !wardHit) return;
    enemy.attackHit = true;
    for (const player of hitPlayers) queueEnemyHit(world, enemy, player, enemy.attackShape);
    return;
  }
  if (enemy.attackHit || !attackShapeHit(enemy.attackShape, target, target.radius)) return;
  enemy.attackHit = true;
  const motionMult = enemy.attackPattern === 'bone-spear'
    ? (ENEMIES[enemy.enemyKind].boneSpear ?? ENEMIES[enemy.enemyKind].patterns['bone-spear']).motionMult
    : 1;
  const knockback = enemy.attackPattern === 'shield-bash'
    ? ENEMIES.shieldbearer.knockback
    : enemy.attackPattern === 'slam' ? (ENEMIES[enemy.enemyKind].knockback ?? 0) : 0;
  queueEnemyHit(world, enemy, target, enemy.attackShape, null, motionMult, knockback);
}

function stepStageEnemy(world, enemy, players) {
  const rooted = (enemy.rootedTicks ?? 0) > 0;
  if (enemy.boss && enemy.boneSpearCooldownTicks > 0) enemy.boneSpearCooldownTicks -= 1;
  if (enemy.summonCooldownTicks > 0) enemy.summonCooldownTicks -= 1;
  if (enemy.spawnTicksLeft > 0) {
    enemy.spawnTicksLeft -= 1;
    enemy.invulnerable = enemy.spawnTicksLeft > 0;
    return;
  }
  if (enemy.stunnedTicks > 0) {
    enemy.stunnedTicks -= 1;
    return;
  }
  if (enemy.recoverTicks > 0) {
    enemy.recoverTicks -= 1;
    if (!enemy.recoverTicks) {
      enemy.attackCooldownTicks = 30;
      if (enemy.enemyKind === 'shieldbearer' && enemy.attackPattern === 'shield-bash') {
        enemy.shieldGuardDownUntilTick = world.tick + 45;
        enemy.attackPattern = null;
      }
    }
    return;
  }
  if (enemy.attackCooldownTicks > 0) {
    enemy.attackCooldownTicks -= 1;
    if (enemy.enemyKind !== 'shieldbearer') return;
  }
  const ward = enemy.objectiveTarget ? currentWard(world) : null;
  const nearbyPlayer = ward && players.some((player) => (
    Math.hypot(player.x - enemy.x, player.z - enemy.z) <= 3
  ));
  const target = ward && !nearbyPlayer ? ward : nearestPlayer(enemy, players);
  if (!target) return;
  if (enemy.enemyKind === 'shieldbearer') {
    const targetAngle = Math.atan2(target.z - enemy.z, target.x - enemy.x);
    const turn = clamp(angleDifference(targetAngle, enemy.facing), -2 * Math.PI / 180, 2 * Math.PI / 180);
    enemy.facing += turn;
    if (enemy.attackCooldownTicks > 0) return;
  }
  if (enemy.boss && enemy.enemyKind === 'commander') maybeBossSummon(world, enemy);
  if (enemy.attackPhase === 'windup') {
    if (enemy.attackRemaining > 1) {
      enemy.attackRemaining -= enemy.slowTicks > 0 ? 0.5 : 1;
      return;
    }
    enemy.attackPhase = 'active';
    enemy.attackRemaining = enemy.attackPattern === 'charge'
      ? 9
      : enemy.attackPattern === 'line-dash'
        ? ENEMIES[enemy.enemyKind].activeTicks
        : (ENEMIES[enemy.enemyKind].activeTicks ?? 3);
    enemy.attackHit = false;
    return;
  }
  if (enemy.attackPhase === 'active') {
    if (enemy.attackPattern === 'summon' || enemy.attackPattern === 'summon-wave') {
      const summonRule = enemy.enemyKind === 'skeletonking'
        ? ENEMIES.skeletonking.patterns['summon-wave']
        : ENEMIES.ashwarden.patterns['summon-wave'];
      const count = enemy.attackPattern === 'summon-wave' ? summonRule.count : ENEMIES.ashcaller.summon.count;
      const livingCount = world.entities.filter((entry) => entry.kind === 'enemy' && !entry.dead && entry.summonedBy === enemy.id).length;
      const allowed = enemy.attackPattern === 'summon-wave'
        ? (livingCount && summonRule.maxAliveWaves ? 0 : count)
        : Math.max(0, ENEMIES.ashcaller.summon.maxAlive - livingCount);
      const composition = enemy.enemyKind === 'skeletonking'
        ? summonRule.enemies
        : { minion: count };
      let index = 0;
      for (const [enemyType, amount] of Object.entries(composition)) {
        for (let entry = 0; entry < amount && index < allowed; entry += 1) {
          const angle = Math.PI * 2 * index / count;
          spawnStageEnemy(world, enemyType, index, false, {
            x: enemy.x + Math.cos(angle) * 1.8,
            z: enemy.z + Math.sin(angle) * 1.8,
          }, enemy.id);
          index += 1;
        }
      }
      enemy.attackCooldownTicks = enemy.attackPattern === 'summon'
        ? ENEMIES.ashcaller.summon.cooldownTicks
        : 90;
      enemy.attackPhase = null;
      enemy.attackShape = null;
      return;
    }
    if (enemy.attackPattern === 'blink-away') {
      const destination = rooted ? null
        : blinkDestination(world, enemy, players, ENEMIES.ashwarden.patterns['blink-away'].minPlayerDistance);
      if (destination) {
        const from = { x: enemy.x, z: enemy.z };
        enemy.x = destination.x;
        enemy.z = destination.z;
        enemy.hitCountSinceBlink = 0;
        enemy.lastBlinkTick = world.tick;
        emit(world, 'bossBlink', { entityId: enemy.id, from, to: { x: enemy.x, z: enemy.z } });
      }
      enemy.attackCooldownTicks = 30;
      enemy.attackPhase = null;
      enemy.attackShape = null;
      return;
    }
    if (enemy.attackPattern === 'charge') {
      if (!rooted) {
        const startX = enemy.x;
        const startZ = enemy.z;
        const directionX = Math.cos(enemy.chargeAngle);
        const directionZ = Math.sin(enemy.chargeAngle);
        const slowFactor = enemy.slowTicks > 0 ? 0.5 : 1;
        moveEntity(world, enemy, directionX * slowFactor, directionZ * slowFactor);
        const travelled = Math.max(0, (enemy.x - startX) * directionX + (enemy.z - startZ) * directionZ);
        enemy.lineTravelled += Math.min(1, travelled);
        enemy.attackShape.length = enemy.lineTravelled;
        if (travelled < 1 - 1e-3) enemy.attackRemaining = 1;
      }
    } else if (enemy.attackPattern === 'line-dash') {
      const shape = enemy.attackShape;
      const directionX = Math.cos(shape.angle);
      const directionZ = Math.sin(shape.angle);
      const slowFactor = enemy.slowTicks > 0 ? 0.5 : 1;
      const distance = Math.min(
        shape.length / Math.max(1, ENEMIES[enemy.enemyKind].activeTicks) * slowFactor,
        Math.max(0, shape.length - enemy.lineTravelled),
      );
      if (!rooted) {
        const startX = enemy.x;
        const startZ = enemy.z;
        moveEntity(world, enemy, directionX * distance, directionZ * distance);
        const travelled = Math.max(0, (enemy.x - startX) * directionX + (enemy.z - startZ) * directionZ);
        enemy.lineTravelled += Math.min(distance, travelled);
        if (travelled < distance - 0.001) enemy.attackRemaining = 1;
      }
    }
    activeEnemyAttack(world, enemy, target);
    enemy.attackRemaining -= 1;
    if (enemy.attackRemaining <= 0) {
      if (enemy.boss && enemy.attackPattern === 'combo' && enemy.comboSwing < 2) {
        enemy.comboSwing += 1;
        const phaseTwo = enemy.hp / enemy.maxHp < 0.5;
        const nextTarget = nearestPlayer(enemy, players);
        const angle = Math.atan2(nextTarget.z - enemy.z, nextTarget.x - enemy.x);
        beginEnemyTelegraph(world, enemy, nextTarget, { type: 'sector', originX: enemy.x, originZ: enemy.z, angle, range: 2.6, halfAngle: 0.82 }, 'combo', bossWindup([18, 12, 12][enemy.comboSwing], phaseTwo));
      } else {
        if (enemy.attackPattern === 'line-dash') enemy.recoverTicks = 30;
        else if (enemy.attackPattern === 'charge') enemy.recoverTicks = 18;
        else if (enemy.attackPattern === 'shield-bash') enemy.recoverTicks = 1;
        else enemy.attackCooldownTicks = enemy.boss ? 30 : ENEMIES[enemy.enemyKind].cooldownTicks;
        enemy.attackPhase = null;
        enemy.attackShape = null;
      }
    }
    return;
  }

  if (enemy.boss) {
    startBossPattern(world, enemy, target);
    return;
  }
  const rule = ENEMIES[enemy.enemyKind];
  const speed = rule.speed * (enemy.slowTicks > 0 ? 0.5 : 1);
  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 0.001 && enemy.enemyKind !== 'shieldbearer') enemy.facing = Math.atan2(dz, dx);
  if (rule.behavior === 'shield-bash') {
    if (distance <= rule.length + target.radius) {
      beginEnemyTelegraph(world, enemy, target, {
        type: 'rect',
        originX: enemy.x,
        originZ: enemy.z,
        angle: enemy.facing,
        length: rule.length,
        width: rule.width,
      }, 'shield-bash', rule.windupTicks);
    } else if (!rooted) {
      moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
    }
    return;
  }
  if (rule.behavior === 'ground-circle' || rule.behavior === 'summoner') {
    if (!rooted && distance > rule.keepDistance + 0.8) {
      moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
    } else if (!rooted && distance < rule.keepDistance - 1.1) {
      moveEntity(world, enemy, -dx / distance * speed / TICK_HZ, -dz / distance * speed / TICK_HZ);
    } else if (rule.behavior === 'summoner' && enemy.summonCooldownTicks === 0
      && world.entities.filter((entry) => entry.kind === 'enemy' && !entry.dead && entry.summonedBy === enemy.id).length < rule.summon.maxAlive) {
      beginEnemyTelegraph(world, enemy, target, { type: 'circle', originX: enemy.x, originZ: enemy.z, radius: 1.1 }, 'summon', rule.summon.windupTicks);
    } else {
      beginEnemyTelegraph(world, enemy, target, { type: 'circle', originX: target.x, originZ: target.z, radius: rule.circleRadius }, rule.behavior, rule.windupTicks);
    }
    return;
  }
  if (rule.behavior === 'ranged-line') {
    if (!rooted && distance > rule.keepDistance + 0.8) moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
    else if (!rooted && distance < rule.keepDistance - 1.1) moveEntity(world, enemy, -dx / distance * speed / TICK_HZ, -dz / distance * speed / TICK_HZ);
    else beginEnemyTelegraph(world, enemy, target, makeLineShape(enemy.x, enemy.z, enemy.facing, rule.length, rule.width), rule.behavior, rule.windupTicks);
    return;
  }
  if (rule.behavior === 'slam') {
    if (distance <= rule.slamRadius) beginEnemyTelegraph(world, enemy, target,
      { type: 'circle', originX: enemy.x, originZ: enemy.z, radius: rule.slamRadius }, rule.behavior, rule.windupTicks);
    else if (!rooted) moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
    return;
  }
  if (rule.behavior === 'line-dash') {
    if (distance <= 6.5) {
      beginEnemyTelegraph(world, enemy, target, makeLineShape(enemy.x, enemy.z, enemy.facing, rule.length, rule.width), rule.behavior, rule.windupTicks);
      enemy.lineTravelled = 0;
    } else if (!rooted && distance > 0.001) {
      moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
    }
    return;
  }
  if (distance <= rule.range) {
    const shape = { type: 'sector', originX: enemy.x, originZ: enemy.z, angle: enemy.facing, range: rule.range, halfAngle: rule.halfAngle };
    beginEnemyTelegraph(world, enemy, target, shape, rule.behavior, rule.windupTicks);
  } else if (!rooted && distance > 0.001) {
    moveEntity(world, enemy, dx / distance * speed / TICK_HZ, dz / distance * speed / TICK_HZ);
  }
}

function settlementResult(world, player, outcome) {
  const reward = world.rewards[player.playerId];
  const retainedGold = outcome === 'clear' ? reward.gold : Math.floor(reward.gold / 2);
  return {
    outcome,
    playerId: player.playerId,
    xp: reward.xp,
    gold: retainedGold,
    goldLost: reward.gold - retainedGold,
    items: outcome === 'clear' ? reward.items.map((item) => ({ ...item })) : [],
    lostItems: outcome === 'clear' ? [] : reward.items.map((item) => ({ ...item })),
    stageId: world.stageId,
    difficulty: world.difficulty ?? 'normal',
    ticks: world.tick,
    potions: player.potions,
    kills: { ...reward.kills },
    perfectDodges: reward.perfectDodges,
    potionsUsed: reward.potionsUsed,
    skillUses: { ...reward.skillUses },
    objective: world.objective
      ? { type: world.objective.type, success: world.objective.state === 'success' }
      : null,
  };
}

function finishStage(world, outcome) {
  if (world.outcome) return;
  if (outcome === 'clear') {
    for (const player of stagePlayers(world)) pickupLoot(world, player, true);
  }
  world.outcome = outcome;
  for (const player of stagePlayers(world)) {
    world.results[player.playerId] = settlementResult(world, player, outcome);
  }
  if (world.partySize === 1) world.result = world.results[world.soloPlayerId];
  emit(world, 'stageEnd', {
    outcome,
    stageId: world.stageId,
    result: world.result ?? null,
    results: { ...world.results },
  });
}

function enterNextRoom(world, door) {
  const players = stagePlayers(world);
  const nextIndex = world.roomIndex + 1;
  if (nextIndex >= world.arena.rooms.length) {
    finishStage(world, 'clear');
    return;
  }
  world.roomIndex = nextIndex;
  world.roomCleared = false;
  world.doorCountdown = null;
  players.forEach((player, index) => {
    player.x = door.x + (index - (players.length - 1) / 2) * 0.9;
    player.z = door.z - 1.7;
    if (player.downed) {
      player.downed = false;
      player.reviveProgress = 0;
      player.hp = Math.max(1, Math.round(player.maxHp * 0.3));
      emit(world, 'revived', { entityId: player.id, playerId: player.playerId, roomEnter: true });
    } else player.hp = Math.max(1, player.hp);
  });
  emit(world, 'roomEnter', {
    roomIndex: nextIndex,
    roomId: world.arena.rooms[nextIndex].id,
    playerIds: players.map((player) => player.playerId),
  });
  spawnRoom(world);
}

function stepRevives(world, players) {
  const downedPlayers = stagePlayers(world).filter((player) => player.downed);
  for (const downed of downedPlayers) {
    const canRevive = players.some((ally) => (
      ally.id !== downed.id && Math.hypot(ally.x - downed.x, ally.z - downed.z) <= 1.5
    ));
    downed.reviveProgress = Math.max(0, downed.reviveProgress + (canRevive ? 1 : -2));
    if (downed.reviveProgress > 0 && world.tick % 15 === 0) {
      emit(world, 'reviveProgress', {
        entityId: downed.id,
        playerId: downed.playerId,
        progress: downed.reviveProgress,
        required: 60,
      });
    }
    if (downed.reviveProgress < 60) continue;
    downed.downed = false;
    downed.reviveProgress = 0;
    downed.hp = Math.max(1, Math.round(downed.maxHp * 0.3));
    emit(world, 'revived', { entityId: downed.id, playerId: downed.playerId });
  }
}

function updateStageProgress(world) {
  if (world.outcome) return;
  const connected = stagePlayers(world).filter((player) => player.connected);
  if (connected.length && connected.every((player) => player.downed || player.dead)) {
    finishStage(world, 'death');
    return;
  }
  const living = stageActiveEnemies(world);
  const roomObjective = world.arena.rooms[world.roomIndex]?.objective
    ? world.objective?.roomIndex === world.roomIndex ? world.objective : null
    : null;
  const objectiveActive = roomObjective?.state === 'active';
  const pendingObjectiveSpawns = (roomObjective?.nextSpawnIndex ?? 0) < (roomObjective?.pendingSpawns?.length ?? 0);
  if (!living.length && (!pendingObjectiveSpawns || !objectiveActive) && !world.roomCleared) {
    world.roomCleared = true;
    const door = world.arena.doors.find((entry) => entry.fromRoom === world.arena.rooms[world.roomIndex]?.id);
    if (door) {
      world.openDoors[door.id] = true;
      emit(world, 'doorOpen', { doorId: door.id, roomIndex: world.roomIndex });
    } else {
      finishStage(world, 'clear');
      return;
    }
  }
  if (!world.roomCleared) return;
  const door = world.arena.doors.find((entry) => entry.fromRoom === world.arena.rooms[world.roomIndex]?.id);
  if (!door) {
    finishStage(world, 'clear');
    return;
  }
  const players = stagePlayers(world);
  if (world.partySize === 1) {
    const player = players.find((entry) => entry.connected && !entry.downed && !entry.dead);
    if (player && Math.hypot(player.x - door.x, player.z - door.z) <= 1.7) enterNextRoom(world, door);
    return;
  }
  if (world.doorCountdown) {
    if (world.tick >= world.doorCountdown.endsTick) enterNextRoom(world, door);
    return;
  }
  const nearDoor = players.some((player) => (
    player.connected && !player.downed && !player.dead &&
    Math.hypot(player.x - door.x, player.z - door.z) <= 1.7
  ));
  if (!nearDoor) return;
  world.doorCountdown = { doorId: door.id, endsTick: world.tick + 90 };
  emit(world, 'doorCountdown', { doorId: door.id, endsTick: world.doorCountdown.endsTick });
}

function pickupLoot(world, player, collectAll = false) {
  for (const loot of [...world.entities]) {
    if (
      loot.kind !== 'loot' ||
      loot.ownerId !== player.playerId ||
      (!collectAll && Math.hypot(player.x - loot.x, player.z - loot.z) > 1)
    ) continue;
    if (loot.lootType === 'potion' && player.potions >= POTION.maxCarry) continue;
    world.entities = world.entities.filter((entity) => entity.id !== loot.id);
    const reward = world.rewards[player.playerId];
    if (loot.lootType === 'gold') reward.gold += loot.gold;
    else if (loot.lootType === 'potion') player.potions += 1;
    else reward.items.push({ ...loot.item, lootId: loot.id });
    emit(world, 'pickup', {
      entityId: player.id,
      playerId: player.playerId,
      lootId: loot.id,
      lootType: loot.lootType,
      gold: loot.gold ?? 0,
      item: loot.item ?? null,
    });
  }
}

function stageStep(world, inputsByPlayerId) {
  for (const entity of world.entities) {
    if (entity.kind === 'enemy' && entity.dead) entity.deathTicks = Math.max(0, entity.deathTicks - 1);
  }
  advanceObjective(world);
  const players = activePlayers(world).sort((a, b) => a.id - b.id);
  const iFramesAtTickStart = new Map(players.map((player) => [player.id, player.iFrames]));
  for (const player of players) {
    if (Object.hasOwn(inputsByPlayerId, player.playerId)) {
      advanceStagePlayer(world, player, inputsByPlayerId[player.playerId]);
    } else if (!world.inputDriven) advanceStagePlayer(world, player, null);
  }
  advanceChannelObjective(world, players);
  for (const player of players) {
    pickupLoot(world, player);
  }
  resolvePendingHits(world, iFramesAtTickStart);
  resolvePendingImpacts(world);
  if (world.partySize > 1) stepRevives(world, players);
  for (const enemy of stageActiveEnemies(world)) stepStageEnemy(world, enemy, players);
  for (const enemy of world.entities) {
    if (enemy.kind === 'enemy') {
      enemy.hitFlashTicks = Math.max(0, enemy.hitFlashTicks - 1);
      enemy.slowTicks = Math.max(0, (enemy.slowTicks ?? 0) - 1);
      if (enemy.rootedTicks > 0) enemy.rootedTicks -= 1;
    }
  }
  cleanupEntities(world);
  updateObjectiveProgress(world);
  updateStageProgress(world);
  recordEnemyHistory(world);
  return world;
}

export function retreatStage(world) {
  if (world.mode !== 'stage') throw new Error('Retreat is only available during a sortie');
  finishStage(world, 'retreat');
  return world.result ?? world.results;
}

export function completeStage(world, outcome = 'clear') {
  if (world.mode !== 'stage' || !['clear', 'death', 'retreat'].includes(outcome)) {
    throw new TypeError('Invalid stage outcome');
  }
  finishStage(world, outcome);
  return world.result ?? world.results;
}

export function setPlayerConnected(world, playerId, connected) {
  const player = stagePlayers(world).find((entry) => entry.playerId === playerId);
  if (!player) return false;
  const nextConnected = Boolean(connected);
  if (player.connected === nextConnected) return true;
  player.connected = nextConnected;
  if (!player.connected) {
    player.lastInput.moveX = 0;
    player.lastInput.moveZ = 0;
    player.lastInput.buttons = 0;
    player.previousButtons = 0;
    player.moving = false;
  }
  emit(world, 'playerConnection', { playerId, connected: player.connected });
  return true;
}

export function leaveStage(world, playerId) {
  if (world.mode !== 'stage') throw new Error('Leaving is only available during a sortie');
  if (world.outcome) return world.results[playerId] ?? null;
  const player = stagePlayers(world).find((entry) => entry.playerId === playerId);
  if (!player) return world.results[playerId] ?? null;
  world.results[playerId] = settlementResult(world, player, 'retreat');
  if (world.partySize === 1 && world.soloPlayerId === playerId) world.result = world.results[playerId];
  world.entities = world.entities.filter((entity) => entity.id !== player.id);
  world.players = world.players.filter((entityId) => entityId !== player.id);
  emit(world, 'playerLeave', { playerId });
  if (!stagePlayers(world).some((entry) => entry.connected)) finishStage(world, 'retreat');
  return world.results[playerId];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function step(world, inputsByPlayerId = {}) {
  world.tick += 1;
  if (world.mode === 'stage') return stageStep(world, inputsByPlayerId);
  for (const entity of world.entities) {
    if (entity.kind === 'enemy' && entity.dead) entity.deathTicks = Math.max(0, entity.deathTicks - 1);
  }
  const playerEntities = world.players
    .map((entityId) => world.entities.find((entity) => entity.id === entityId))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
  const iFramesAtTickStart = new Map(playerEntities.map((player) => [player.id, player.iFrames]));
  for (const player of playerEntities) {
    const hasInput = Object.hasOwn(inputsByPlayerId, player.playerId);
    stepPlayer(world, player, hasInput ? inputsByPlayerId[player.playerId] : null);
  }

  const players = activePlayers(world).sort((a, b) => a.id - b.id);
  const enemies = activeEnemies(world).sort((a, b) => a.id - b.id);
  for (const enemy of enemies) stepEnemy(world, enemy, players);
  separateEnemies(world);

  for (const player of playerEntities) {
    player.dodgeTicks = Math.max(0, player.dodgeTicks - 1);
    player.iFrames = Math.max(0, player.iFrames - 1);
    player.dodgeCooldownTicks = Math.max(0, player.dodgeCooldownTicks - 1);
    player.hitFlashTicks = Math.max(0, player.hitFlashTicks - 1);
  }
  resolvePendingHits(world, iFramesAtTickStart);
  for (const enemy of world.entities) {
    if (enemy.kind === 'enemy') enemy.hitFlashTicks = Math.max(0, enemy.hitFlashTicks - 1);
  }
  cleanupEntities(world);
  if (world.mode !== 'hub') ensureWave(world);
  return world;
}

export function hashWorld(world) {
  const serialized = stableStringify(world);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
