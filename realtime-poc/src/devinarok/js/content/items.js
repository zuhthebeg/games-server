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
];

export const ITEMS = Object.fromEntries(ITEM_BASES.map((item) => [item.id, item]));

export const FAMILY_STARTER_WEAPONS = [
  { itemId: 'rusted-crossbow', price: 30 },
  { itemId: 'apprentice-wand', price: 30 },
];

export function equipmentLook(equipment = []) {
  const slotOf = (item) => item.slot ?? ITEMS[item.itemId]?.slot;
  const weapon = equipment.find((item) => slotOf(item) === 'weapon');
  const family = ITEMS[weapon?.itemId]?.family ?? 'sword';
  const weaponModels = {
    sword: ['grave-greatsword', 'necromancer-sword', 'royal-sword', 'king-sword'].includes(weapon?.itemId) ? '2H_Sword' : '1H_Sword',
    crossbow: (ITEMS[weapon?.itemId]?.requiredLevel ?? 1) >= 5 ? '2H_Crossbow' : '1H_Crossbow',
    staff: (ITEMS[weapon?.itemId]?.requiredLevel ?? 1) === 1 ? '1H_Wand' : '2H_Staff',
  };
  return {
    family,
    characterKind: { sword: 'knight', crossbow: 'rogue', staff: 'mage' }[family],
    weapon: weaponModels[family],
    offhand: family === 'sword' && weaponModels.sword === '1H_Sword' ? 'Round_Shield' : null,
    helmet: equipment.some((item) => slotOf(item) === 'head'),
    cape: equipment.some((item) => slotOf(item) === 'body'),
    weaponRarity: RARITY_IDS.has(weapon?.rarity) ? weapon.rarity : null,
  };
}

const RARITY_IDS = new Set(['common', 'magic', 'rare', 'legendary']);

export const RARITIES = {
  common: { name: '일반', weight: 60, affixes: 0, color: 0xc7c2bb },
  magic: { name: '마법', weight: 30, affixes: 1, color: 0x6388ff },
  rare: { name: '희귀', weight: 9, affixes: 2, color: 0xf0c64f },
  legendary: { name: '전설', weight: 1, affixes: 3, color: 0xff8b38 },
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

export const LEGENDARIES = [
  { id: 'spinning-sigil', name: '회전의 문장', stat: 'spinCooldownSeconds', value: -2 },
  { id: 'grave-drinker', name: '묘지의 포식자', stat: 'lifesteal', value: 4 },
  { id: 'last-ward', name: '마지막 수호', stat: 'maxHp', value: 36 },
];
