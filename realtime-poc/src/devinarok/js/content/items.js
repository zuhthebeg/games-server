export const ITEM_BASES = [
  { id: 'rusted-sword', name: '낡은 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 4, requiredLevel: 1 },
  { id: 'knight-sword', name: '기사의 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 8, requiredLevel: 3 },
  { id: 'grave-greatsword', name: '묘지기의 대검', slot: 'weapon', family: 'sword', stat: 'attack', value: 14, requiredLevel: 5 },
  { id: 'rusted-crossbow', name: '낡은 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 4, requiredLevel: 1 },
  { id: 'hunter-crossbow', name: '추적자의 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 8, requiredLevel: 3 },
  { id: 'grave-crossbow', name: '묘지기의 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 14, requiredLevel: 5 },
  { id: 'apprentice-wand', name: '견습자의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 4, requiredLevel: 1 },
  { id: 'grave-staff', name: '사제의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 8, requiredLevel: 3 },
  { id: 'elder-staff', name: '묘지기의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 14, requiredLevel: 5 },
  { id: 'ash-sword', name: '잿빛 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 20, requiredLevel: 7 },
  { id: 'ash-crossbow', name: '잿빛 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 20, requiredLevel: 7 },
  { id: 'ash-staff', name: '잿빛 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 20, requiredLevel: 7 },
  { id: 'necromancer-sword', name: '사령의 대검', slot: 'weapon', family: 'sword', stat: 'attack', value: 26, requiredLevel: 9 },
  { id: 'necromancer-crossbow', name: '사령의 쇠뇌', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 26, requiredLevel: 9 },
  { id: 'necromancer-staff', name: '사령의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 26, requiredLevel: 9 },
  { id: 'patched-hood', name: '기운 두건', slot: 'head', stat: 'defense', value: 1, requiredLevel: 1 },
  { id: 'guard-helm', name: '수호 투구', slot: 'head', stat: 'defense', value: 3, requiredLevel: 3 },
  { id: 'ossuary-helm', name: '납골당 투구', slot: 'head', stat: 'maxHp', value: 12, requiredLevel: 5 },
  { id: 'patched-coat', name: '기운 외투', slot: 'body', stat: 'maxHp', value: 8, requiredLevel: 1 },
  { id: 'guard-mail', name: '수호 갑옷', slot: 'body', stat: 'defense', value: 4, requiredLevel: 3 },
  { id: 'ossuary-plate', name: '납골당 흉갑', slot: 'body', stat: 'maxHp', value: 24, requiredLevel: 5 },
  { id: 'leather-grips', name: '가죽 장갑', slot: 'hands', stat: 'defense', value: 1, requiredLevel: 1 },
  { id: 'iron-gauntlets', name: '철 건틀릿', slot: 'hands', stat: 'attack', value: 2, requiredLevel: 3 },
  { id: 'bone-gauntlets', name: '뼈 건틀릿', slot: 'hands', stat: 'defense', value: 4, requiredLevel: 5 },
  { id: 'worn-boots', name: '해진 장화', slot: 'feet', stat: 'maxHp', value: 5, requiredLevel: 1 },
  { id: 'guard-boots', name: '수호 장화', slot: 'feet', stat: 'defense', value: 2, requiredLevel: 3 },
  { id: 'ossuary-greaves', name: '납골당 각반', slot: 'feet', stat: 'maxHp', value: 16, requiredLevel: 5 },
  { id: 'ash-hood', name: '잿빛 두건', slot: 'head', stat: 'maxHp', value: 17, requiredLevel: 7 },
  { id: 'ash-coat', name: '잿빛 외투', slot: 'body', stat: 'maxHp', value: 34, requiredLevel: 7 },
  { id: 'ash-gloves', name: '잿빛 장갑', slot: 'hands', stat: 'defense', value: 6, requiredLevel: 7 },
  { id: 'ash-greaves', name: '잿빛 각반', slot: 'feet', stat: 'maxHp', value: 22, requiredLevel: 7 },
  { id: 'necromancer-hood', name: '사령의 두건', slot: 'head', stat: 'maxHp', value: 22, requiredLevel: 9 },
  { id: 'necromancer-robe', name: '사령의 로브', slot: 'body', stat: 'maxHp', value: 44, requiredLevel: 9 },
  { id: 'necromancer-gloves', name: '사령의 장갑', slot: 'hands', stat: 'defense', value: 7, requiredLevel: 9 },
  { id: 'necromancer-greaves', name: '사령 각반', slot: 'feet', stat: 'maxHp', value: 30, requiredLevel: 9 },
  { id: 'royal-sword', name: '왕실 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 32, requiredLevel: 11 },
  { id: 'royal-crossbow', name: '왕실 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 32, requiredLevel: 11 },
  { id: 'royal-staff', name: '왕실 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 32, requiredLevel: 11 },
  { id: 'royal-helm', name: '왕실 투구', slot: 'head', stat: 'maxHp', value: 28, requiredLevel: 11 },
  { id: 'royal-plate', name: '왕실 흉갑', slot: 'body', stat: 'maxHp', value: 55, requiredLevel: 11 },
  { id: 'royal-gauntlets', name: '왕실 건틀릿', slot: 'hands', stat: 'defense', value: 9, requiredLevel: 11 },
  { id: 'royal-greaves', name: '왕실 각반', slot: 'feet', stat: 'maxHp', value: 37, requiredLevel: 11 },
  { id: 'king-sword', name: '해골 왕의 검', slot: 'weapon', family: 'sword', stat: 'attack', value: 39, requiredLevel: 13 },
  { id: 'king-crossbow', name: '해골 왕의 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 39, requiredLevel: 13 },
  { id: 'king-staff', name: '해골 왕의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 39, requiredLevel: 13 },
  { id: 'king-helm', name: '해골 왕의 투구', slot: 'head', stat: 'maxHp', value: 34, requiredLevel: 13 },
  { id: 'king-plate', name: '해골 왕의 갑옷', slot: 'body', stat: 'maxHp', value: 67, requiredLevel: 13 },
  { id: 'king-gauntlets', name: '해골 왕의 건틀릿', slot: 'hands', stat: 'defense', value: 11, requiredLevel: 13 },
  { id: 'king-greaves', name: '해골 왕의 각반', slot: 'feet', stat: 'maxHp', value: 45, requiredLevel: 13 },
  { id: 'nightmare-sword', name: '악몽의 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 45, requiredLevel: 15 },
  { id: 'nightmare-crossbow', name: '악몽의 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 45, requiredLevel: 15 },
  { id: 'nightmare-staff', name: '악몽의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 45, requiredLevel: 15 },
  { id: 'nightmare-helm', name: '악몽 투구', slot: 'head', stat: 'maxHp', value: 40, requiredLevel: 15 },
  { id: 'nightmare-plate', name: '악몽 흉갑', slot: 'body', stat: 'maxHp', value: 79, requiredLevel: 15 },
  { id: 'nightmare-gauntlets', name: '악몽 건틀릿', slot: 'hands', stat: 'defense', value: 13, requiredLevel: 15 },
  { id: 'nightmare-greaves', name: '악몽 각반', slot: 'feet', stat: 'maxHp', value: 53, requiredLevel: 15 },
  { id: 'hell-sword', name: '지옥불 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 51, requiredLevel: 18 },
  { id: 'hell-crossbow', name: '지옥불 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 51, requiredLevel: 18 },
  { id: 'hell-staff', name: '지옥불 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 51, requiredLevel: 18 },
  { id: 'hell-helm', name: '지옥불 투구', slot: 'head', stat: 'maxHp', value: 46, requiredLevel: 18 },
  { id: 'hell-plate', name: '지옥불 흉갑', slot: 'body', stat: 'maxHp', value: 91, requiredLevel: 18 },
  { id: 'hell-gauntlets', name: '지옥불 건틀릿', slot: 'hands', stat: 'defense', value: 15, requiredLevel: 18 },
  { id: 'hell-greaves', name: '지옥불 각반', slot: 'feet', stat: 'maxHp', value: 61, requiredLevel: 18 },
  { id: 'oath-sword', name: '수호기사의 장검', slot: 'weapon', family: 'sword', stat: 'attack', value: 45, requiredLevel: 15, setId: 'guardian-oath' },
  { id: 'oath-helm', name: '수호기사의 투구', slot: 'head', stat: 'maxHp', value: 40, requiredLevel: 15, setId: 'guardian-oath' },
  { id: 'oath-plate', name: '수호기사의 흉갑', slot: 'body', stat: 'maxHp', value: 79, requiredLevel: 15, setId: 'guardian-oath' },
  { id: 'oath-gauntlets', name: '수호기사의 건틀릿', slot: 'hands', stat: 'defense', value: 13, requiredLevel: 15, setId: 'guardian-oath' },
  { id: 'oath-greaves', name: '수호기사의 각반', slot: 'feet', stat: 'maxHp', value: 53, requiredLevel: 15, setId: 'guardian-oath' },
  { id: 'shadow-crossbow', name: '그림자 사냥꾼의 석궁', slot: 'weapon', family: 'crossbow', stat: 'attack', value: 45, requiredLevel: 15, setId: 'shadow-hunter' },
  { id: 'shadow-helm', name: '그림자 사냥꾼의 투구', slot: 'head', stat: 'maxHp', value: 40, requiredLevel: 15, setId: 'shadow-hunter' },
  { id: 'shadow-plate', name: '그림자 사냥꾼의 흉갑', slot: 'body', stat: 'maxHp', value: 79, requiredLevel: 15, setId: 'shadow-hunter' },
  { id: 'shadow-gauntlets', name: '그림자 사냥꾼의 건틀릿', slot: 'hands', stat: 'defense', value: 13, requiredLevel: 15, setId: 'shadow-hunter' },
  { id: 'shadow-greaves', name: '그림자 사냥꾼의 각반', slot: 'feet', stat: 'maxHp', value: 53, requiredLevel: 15, setId: 'shadow-hunter' },
  { id: 'ember-staff', name: '잿불 현자의 지팡이', slot: 'weapon', family: 'staff', stat: 'attack', value: 45, requiredLevel: 15, setId: 'ember-sage' },
  { id: 'ember-helm', name: '잿불 현자의 투구', slot: 'head', stat: 'maxHp', value: 40, requiredLevel: 15, setId: 'ember-sage' },
  { id: 'ember-plate', name: '잿불 현자의 흉갑', slot: 'body', stat: 'maxHp', value: 79, requiredLevel: 15, setId: 'ember-sage' },
  { id: 'ember-gauntlets', name: '잿불 현자의 건틀릿', slot: 'hands', stat: 'defense', value: 13, requiredLevel: 15, setId: 'ember-sage' },
  { id: 'ember-greaves', name: '잿불 현자의 각반', slot: 'feet', stat: 'maxHp', value: 53, requiredLevel: 15, setId: 'ember-sage' },
];

export const ITEMS = Object.fromEntries(ITEM_BASES.map((item) => [item.id, item]));

export const FAMILY_STARTER_WEAPONS = [
  { itemId: 'rusted-crossbow', price: 30 },
  { itemId: 'apprentice-wand', price: 30 },
];

export function equipmentLook(equipment = []) {
  const slotOf = (item) => item.slot ?? ITEMS[item.itemId]?.slot;
  const weapon = equipment.find((item) => slotOf(item) === 'weapon');
  const head = equipment.find((item) => slotOf(item) === 'head');
  const body = equipment.find((item) => slotOf(item) === 'body');
  const family = ITEMS[weapon?.itemId]?.family ?? 'sword';
  const weaponModels = {
    sword: ['grave-greatsword', 'necromancer-sword', 'royal-sword', 'king-sword'].includes(weapon?.itemId) ? '2H_Sword' : '1H_Sword',
    crossbow: (ITEMS[weapon?.itemId]?.requiredLevel ?? 1) >= 5 ? '2H_Crossbow' : '1H_Crossbow',
    staff: (ITEMS[weapon?.itemId]?.requiredLevel ?? 1) === 1 ? '1H_Wand' : '2H_Staff',
  };
  const setCounts = new Map();
  for (const item of equipment) {
    const setId = ITEMS[item.itemId]?.setId;
    if (setId) setCounts.set(setId, (setCounts.get(setId) ?? 0) + 1);
  }
  return {
    family,
    characterKind: { sword: 'knight', crossbow: 'rogue', staff: 'mage' }[family],
    weapon: weaponModels[family],
    offhand: family === 'sword' && weaponModels.sword === '1H_Sword' ? 'Round_Shield' : null,
    helmet: equipment.some((item) => slotOf(item) === 'head'),
    cape: equipment.some((item) => slotOf(item) === 'body'),
    weaponRarity: RARITY_IDS.has(weapon?.rarity) ? weapon.rarity : null,
    weaponItem: weapon?.itemId ?? null,
    head: head?.itemId ?? null,
    body: body?.itemId ?? null,
    headRarity: RARITY_IDS.has(head?.rarity) ? head.rarity : null,
    bodyRarity: RARITY_IDS.has(body?.rarity) ? body.rarity : null,
    setId: [...setCounts].find(([, count]) => count >= 4)?.[0] ?? null,
  };
}

const RARITY_IDS = new Set(['common', 'magic', 'rare', 'legendary', 'set']);

export const RARITIES = {
  common: { name: '일반', weight: 60, affixes: 0, color: 0xc7c2bb },
  magic: { name: '마법', weight: 30, affixes: 1, color: 0x6388ff },
  rare: { name: '희귀', weight: 9, affixes: 2, color: 0xf0c64f },
  legendary: { name: '전설', weight: 1, affixes: 3, color: 0xff8b38 },
  set: { name: '세트', weight: 0, affixes: 2, color: 0x3fd68a },
};

export const ITEM_SETS = {
  'guardian-oath': {
    name: '수호기사의 맹세',
    family: 'sword',
    bonuses: [
      { pieces: 2, description: '최대 체력 +15%' },
      { pieces: 4, description: '반격 피해 +40% · 반격 준비 3초' },
    ],
  },
  'shadow-hunter': {
    name: '그림자 사냥꾼',
    family: 'crossbow',
    bonuses: [
      { pieces: 2, description: '공격 속도 +10%' },
      { pieces: 4, description: '완벽 회피 후 기본 사격 3회 관통' },
    ],
  },
  'ember-sage': {
    name: '잿불 현자',
    family: 'staff',
    bonuses: [
      { pieces: 2, description: '기술 재사용 대기시간 -15%' },
      { pieces: 4, description: '완벽 회피 반격 시 2초 화염 장판' },
    ],
  },
};

export const ELITE_RARITIES = [
  { rarity: 'common', weight: 0 },
  { rarity: 'magic', weight: 70 },
  { rarity: 'rare', weight: 25 },
  { rarity: 'legendary', weight: 5 },
];

export const BOSS_RARITIES = [
  { rarity: 'rare', weight: 80 },
  { rarity: 'legendary', weight: 20 },
];

export const BOSS_RARITIES_NIGHTMARE = [
  { rarity: 'rare', weight: 60 },
  { rarity: 'legendary', weight: 40 },
];

export const BOSS_RARITIES_HELL = [
  { rarity: 'rare', weight: 40 },
  { rarity: 'legendary', weight: 60 },
];

export const LEGENDARIES = [
  { id: 'spinning-sigil', name: '회전의 문장', stat: 'spinCooldownSeconds', value: -2 },
  { id: 'grave-drinker', name: '묘지의 포식자', stat: 'lifesteal', value: 4 },
  { id: 'last-ward', name: '마지막 수호', stat: 'maxHp', value: 36 },
];
