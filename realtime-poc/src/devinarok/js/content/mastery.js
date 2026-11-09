import { SKILLS } from './skills.js';

export const MASTERY_THRESHOLDS = Object.freeze([0, 10, 30, 70, 150, 300]);
export const MASTERY_MAX_XP = MASTERY_THRESHOLDS.at(-1);

export function masteryRank(xp) {
  const value = Number.isInteger(xp) ? Math.max(0, Math.min(MASTERY_MAX_XP, xp)) : 0;
  for (let rank = MASTERY_THRESHOLDS.length - 1; rank >= 0; rank -= 1) {
    if (value >= MASTERY_THRESHOLDS[rank]) return rank;
  }
  return 0;
}

export function masteryBonus(rank) {
  const value = Number.isInteger(rank) ? Math.max(0, Math.min(5, rank)) : 0;
  return { damagePct: value * 5, cooldownPct: value * 3 };
}

export function nextThreshold(xp) {
  const rank = masteryRank(xp);
  return rank === 5 ? null : MASTERY_THRESHOLDS[rank + 1];
}

export function MASTERY_MIN_COOLDOWN_TICKS(skillKey) {
  return Math.max(1, Math.round(SKILLS[skillKey].cooldownTicks * 0.4 * 0.85));
}
