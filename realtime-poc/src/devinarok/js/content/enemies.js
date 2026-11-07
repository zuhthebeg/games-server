export const ENEMIES = {
  minion: {
    id: 'minion', model: 'Skeleton_Minion', hp: 30, attack: 8, speed: 1.8, radius: 0.38,
    behavior: 'melee-sector', range: 1.4, windupTicks: 15, activeTicks: 3, cooldownTicks: 30,
    halfAngle: 0.68, xp: 12, gold: [2, 5], dropChance: 0.08,
  },
  warrior: {
    id: 'warrior', model: 'Skeleton_Warrior', hp: 70, attack: 14, speed: 1.2, radius: 0.48,
    behavior: 'melee-sector', range: 1.9, windupTicks: 21, activeTicks: 4, cooldownTicks: 40,
    halfAngle: 0.82, knockback: 0.45, xp: 28, gold: [2, 5], dropChance: 0.15,
  },
  rogue: {
    id: 'rogue', model: 'Skeleton_Rogue', hp: 40, attack: 10, speed: 2.6, radius: 0.38,
    behavior: 'line-dash', length: 5, width: 0.8, windupTicks: 18, activeTicks: 6, cooldownTicks: 45,
    recoveryTicks: 30, xp: 20, gold: [2, 5], dropChance: 0.12,
  },
  mage: {
    id: 'mage', model: 'Skeleton_Mage', hp: 35, attack: 12, speed: 1.4, radius: 0.38,
    behavior: 'ground-circle', keepDistance: 6, circleRadius: 1.3, windupTicks: 24, activeTicks: 3,
    cooldownTicks: 48, xp: 22, gold: [2, 5], dropChance: 0.12,
  },
  ashcaller: {
    id: 'ashcaller', model: 'Skeleton_Mage', hp: 35, attack: 12, speed: 1.4, radius: 0.38,
    tint: 0x949a93,
    behavior: 'summoner', keepDistance: 7, circleRadius: 1.3, windupTicks: 24, activeTicks: 3,
    cooldownTicks: 48, xp: 22, gold: [2, 5], dropChance: 0.12,
    summon: { enemy: 'minion', count: 2, windupTicks: 30, cooldownTicks: 240, maxAlive: 4 },
  },
  bonearcher: {
    id: 'bonearcher', model: 'Skeleton_Rogue', hp: 40, attack: 10, speed: 2.1, radius: 0.38,
    behavior: 'ranged-line', keepDistance: 6, length: 10, width: 0.6, windupTicks: 20,
    activeTicks: 2, cooldownTicks: 60, xp: 20, gold: [2, 5], dropChance: 0.12,
  },
  brute: {
    id: 'brute', model: 'Skeleton_Warrior', hp: 160, attack: 20, speed: 0.9, radius: 0.62, scale: 1.3,
    behavior: 'slam', slamRadius: 2.2, windupTicks: 28, activeTicks: 3, cooldownTicks: 90,
    knockback: 0.8, xp: 48, gold: [3, 7], dropChance: 0.18,
  },
  shieldbearer: {
    id: 'shieldbearer', model: 'Skeleton_Warrior', hp: 140, attack: 18, speed: 0.85, radius: 0.52,
    behavior: 'shield-bash', length: 1.2, width: 1.6, windupTicks: 22, activeTicks: 3, cooldownTicks: 58,
    knockback: 1, xp: 54, gold: [3, 7], dropChance: 0.2,
  },
  commander: {
    id: 'commander', model: 'Skeleton_Warrior', hp: 900, attack: 20, speed: 1.5, radius: 0.75,
    behavior: 'boss-patterns', scale: 1.6, xp: 420, gold: [2, 5], dropChance: 1,
    boneSpear: {
      name: '뼈 창 투척',
      minTargetDistance: 5.5,
      length: 14,
      width: 1,
      windupTicks: 24,
      phaseTwoWindupTicks: 18,
      motionMult: 1.2,
      cooldownTicks: 150,
    },
  },
  ashwarden: {
    id: 'ashwarden', model: 'Skeleton_Mage', hp: 1300, attack: 22, speed: 1.2, radius: 0.85,
    behavior: 'boss-patterns', scale: 1.8, xp: 620, gold: [4, 9], dropChance: 1,
    patterns: {
      'summon-wave': { count: 4, windupTicks: 30, maxAliveWaves: 1 },
      'ash-rain': { radius: 1.6, windupTicks: 24, randomCircles: 2, phaseTwoExtra: 2 },
      'bone-spear': {
        minTargetDistance: 5.5, length: 14, width: 1, windupTicks: 24,
        phaseTwoWindupTicks: 18, motionMult: 1.2, cooldownTicks: 150,
      },
      'blink-away': { hitThreshold: 12, tickInterval: 300, windupTicks: 18, minPlayerDistance: 6 },
    },
  },
  skeletonking: {
    id: 'skeletonking', model: 'Skeleton_Warrior', hp: 1800, attack: 15, speed: 1.15, radius: 1,
    behavior: 'boss-patterns', scale: 2, tint: 0xd7bc63, xp: 900, gold: [8, 16], dropChance: 1,
    patterns: {
      cleave: { range: 4, halfAngle: Math.PI / 3, windupTicks: 26 },
      'royal-nova': { innerRadius: 2.2, outerRadius: 7, windupTicks: 32 },
      'summon-wave': { count: 3, windupTicks: 30, maxAliveWaves: 1, enemies: { shieldbearer: 1, minion: 2 } },
      'bone-spear': {
        minTargetDistance: 5.5, length: 14, width: 1, windupTicks: 24,
        phaseTwoWindupTicks: 18, motionMult: 1.2, cooldownTicks: 150,
      },
      'grave-rise': { radius: 1.4, randomCircles: 3, windupTicks: 24 },
    },
  },
};
