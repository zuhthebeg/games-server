export const SKILLS = {
  spin: { id: 1, name: '회전베기', windupTicks: 5, activeTicks: 6, recoveryTicks: 10, range: 2.2, motionMult: 1.4, cooldownTicks: 180 },
  dash: { id: 2, name: '돌진 찌르기', dashDistance: 4, dashTicks: 6, length: 4, width: 1, motionMult: 2, cooldownTicks: 240 },
  guard: { id: 3, name: '수호의 자세', durationTicks: 45, halfAngle: Math.PI / 3, damageMultiplier: 0.3, perfectTicks: 6, stunTicks: 30, cooldownTicks: 360 },
  quake: { id: 4, name: '대지 강타', windupTicks: 14, forwardOffset: 1.2, radius: 3, motionMult: 2.6, stunTicks: 24, cooldownTicks: 450 },
  deadBurst: { id: 4, name: '망자의 폭발', windupTicks: 10, radius: 3.4, motionMult: 3.4, knockback: 1.0, hpCostFraction: 0.15, cooldownTicks: 450 },
  pierce: { id: 1, name: '관통 사격', windupTicks: 9, length: 12, width: 0.7, motionMult: 1.8, cooldownTicks: 180 },
  vault: { id: 2, name: '후퇴 사격', retreatDistance: 3.5, dashTicks: 6, iframeTicks: 6, motionMult: 1.4, cooldownTicks: 240 },
  volley: { id: 3, name: '산탄', windupTicks: 6, length: 6.5, width: 0.45, spread: Math.PI * 25 / 180, count: 5, motionMult: 0.6, cooldownTicks: 300 },
  poisonArrow: { id: 3, name: '맹독 화살', windupTicks: 6, length: 11, width: 0.6, motionMult: 1.0, poisonTicks: 75, poisonEvery: 15, poisonMotionMult: 0.4, cooldownTicks: 300 },
  rain: { id: 4, name: '화살비', windupTicks: 10, range: 9, fallbackDistance: 6, radius: 2.2, hitCount: 5, hitEvery: 8, motionMult: 0.55, cooldownTicks: 420 },
  flame: { id: 1, name: '화염 장판', windupTicks: 6, radius: 2.4, range: 8, burnTicks: 90, hitEvery: 15, motionMult: 0.4, cooldownTicks: 270 },
  frost: { id: 2, name: '냉기 파동', windupTicks: 5, radius: 3.5, motionMult: 1, slowTicks: 45, cooldownTicks: 240 },
  cursedHands: { id: 2, name: '저주받은 손', windupTicks: 8, range: 8, fallbackDistance: 6, radius: 2.6, motionMult: 0.8, rootTicks: 60, bossRootTicks: 20, cooldownTicks: 240 },
  blink: { id: 3, name: '점멸', distance: 5, iframeTicks: 8, cooldownTicks: 210 },
  meteor: { id: 4, name: '메테오', windupTicks: 30, range: 8, fallbackDistance: 6, radius: 2.8, motionMult: 3.2, knockback: 0.8, cooldownTicks: 540 },
};

export const FAMILY_SKILLS = {
  sword: ['spin', 'dash', 'guard', 'quake'],
  crossbow: ['pierce', 'vault', 'volley', 'rain'],
  staff: ['flame', 'frost', 'blink', 'meteor'],
};

export const LINEAGE_SKILL_SWAPS = Object.freeze({
  skeleton_knight: Object.freeze({ quake: 'deadBurst' }),
  skeleton_archer: Object.freeze({ volley: 'poisonArrow' }),
  skeleton_mage: Object.freeze({ frost: 'cursedHands' }),
});

export function skillsFor(family, lineage = 'human') {
  const base = FAMILY_SKILLS[family] ?? FAMILY_SKILLS.sword;
  const swaps = LINEAGE_SKILL_SWAPS[lineage] ?? {};
  return base.map((key) => swaps[key] ?? key);
}

export const POTION = { healFraction: 0.4, durationTicks: 30, cooldownTicks: 30, maxCarry: 5 };
export const POTION_DROP = { normal: 0.06, elite: 0.25, boss: 1 };
