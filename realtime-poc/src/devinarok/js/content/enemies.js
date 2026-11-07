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
};
