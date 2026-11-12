export const LINEAGES = Object.freeze({
  human: Object.freeze({
    id: 'human', name: '인간', family: null, model: null, evolvedName: null,
  }),
  skeleton_knight: Object.freeze({
    id: 'skeleton_knight', name: '해골 기사', family: 'sword', model: 'Skeleton_Warrior', evolvedName: '데스나이트',
  }),
  skeleton_archer: Object.freeze({
    id: 'skeleton_archer', name: '해골 궁수', family: 'crossbow', model: 'Skeleton_Rogue', evolvedName: '데스 아처',
  }),
  skeleton_mage: Object.freeze({
    id: 'skeleton_mage', name: '해골 마법사', family: 'staff', model: 'Skeleton_Mage', evolvedName: '리치',
  }),
});

export const LINEAGE_EVOLVE_LEVEL = 20;
export const LINEAGE_EVOLVE_STAGE = 'R10';
export const LINEAGE_CHANGE_COST = 1000;

export function lineageOf(character) {
  const id = typeof character === 'string' ? character : character?.lineage;
  return Object.hasOwn(LINEAGES, id) ? id : 'human';
}

export function playerFamily(character, look) {
  return LINEAGES[lineageOf(character)].family ?? look.family;
}

export function isSkeletonLineage(id) {
  return Boolean(LINEAGES[id]?.family);
}

export function isEvolved(character) {
  return isSkeletonLineage(lineageOf(character))
    && character?.level >= LINEAGE_EVOLVE_LEVEL
    && character?.clearedStages?.includes(LINEAGE_EVOLVE_STAGE) === true;
}

export function lineageAllowsFamily(id, family) {
  const lineage = LINEAGES[id];
  return Boolean(lineage && (lineage.family === null || lineage.family === family));
}

export function lineageChangeCost(character) {
  return (character?.lineageChanges ?? 0) === 0 ? 0 : LINEAGE_CHANGE_COST;
}

export function lineageDisplayName(name, character) {
  const lineage = LINEAGES[lineageOf(character)];
  return lineage.family === null
    ? String(name ?? '')
    : `${name ?? ''} · ${(typeof character?.evolved === 'boolean' ? character.evolved : isEvolved(character))
      ? lineage.evolvedName
      : lineage.name}`;
}
