export const SKILLS = {
  spin: { id: 1, name: '회전베기', windupTicks: 5, activeTicks: 6, recoveryTicks: 10, range: 2.2, motionMult: 1.4, cooldownTicks: 180 },
  dash: { id: 2, name: '돌진 찌르기', dashDistance: 4, dashTicks: 6, length: 4, width: 1, motionMult: 2, cooldownTicks: 240 },
  guard: { id: 3, name: '수호의 자세', durationTicks: 45, halfAngle: Math.PI / 3, damageMultiplier: 0.3, perfectTicks: 6, stunTicks: 30, cooldownTicks: 360 },
  pierce: { id: 1, name: '관통 사격', windupTicks: 9, length: 12, width: 0.7, motionMult: 1.8, cooldownTicks: 180 },
  vault: { id: 2, name: '후퇴 사격', retreatDistance: 3.5, dashTicks: 6, iframeTicks: 6, motionMult: 1.4, cooldownTicks: 240 },
  volley: { id: 3, name: '산탄', windupTicks: 6, length: 6.5, width: 0.45, spread: Math.PI * 25 / 180, count: 5, motionMult: 0.6, cooldownTicks: 300 },
  flame: { id: 1, name: '화염 장판', windupTicks: 6, radius: 2.4, range: 8, burnTicks: 90, hitEvery: 15, motionMult: 0.4, cooldownTicks: 270 },
  frost: { id: 2, name: '냉기 파동', windupTicks: 5, radius: 3.5, motionMult: 1, slowTicks: 45, cooldownTicks: 240 },
  blink: { id: 3, name: '점멸', distance: 5, iframeTicks: 8, cooldownTicks: 210 },
};

export const FAMILY_SKILLS = {
  sword: ['spin', 'dash', 'guard'],
  crossbow: ['pierce', 'vault', 'volley'],
  staff: ['flame', 'frost', 'blink'],
};

export const POTION = { healFraction: 0.4, durationTicks: 30, cooldownTicks: 30, maxCarry: 5 };
