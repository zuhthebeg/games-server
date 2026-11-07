export const SKILLS = {
  spin: { id: 1, name: '회전베기', windupTicks: 5, activeTicks: 6, recoveryTicks: 10, range: 2.2, motionMult: 1.4, cooldownTicks: 180 },
  dash: { id: 2, name: '돌진 찌르기', dashDistance: 4, dashTicks: 6, length: 4, width: 1, motionMult: 2, cooldownTicks: 240 },
  guard: { id: 3, name: '수호의 자세', durationTicks: 45, halfAngle: Math.PI / 3, damageMultiplier: 0.3, perfectTicks: 6, stunTicks: 30, cooldownTicks: 360 },
};

export const POTION = { healFraction: 0.4, durationTicks: 30, cooldownTicks: 30, maxCarry: 5 };
