import { DIFFICULTIES, effectiveStageLevel } from './stages.js';

export const OBJECTIVE_LABELS = {
  hunt: '현상수배',
  defend: '결계석 방어',
  channel: '봉인 의식',
};

export function objectiveBonusGold(stage, difficulty = 'normal') {
  return Math.round(15 * effectiveStageLevel(stage, difficulty) * DIFFICULTIES[difficulty].goldMult);
}

export function objectiveExtraSpawns(objective) {
  if (objective?.type === 'hunt') return [{ enemy: objective.target, count: 1 }];
  if (objective?.type === 'defend' || objective?.type === 'channel') {
    return (objective.spawns ?? []).map(({ enemy, count }) => ({ enemy, count }));
  }
  return [];
}
