import { AFFIXES } from './affixes.js';

export function rollAffixValue(id, ilvl, uniformRoll) {
  const range = AFFIXES[id];
  if (!range) throw new TypeError(`Unknown affix: ${id}`);
  return Math.round(range.min + uniformRoll * (range.max - range.min) + range.perIlvl * ilvl);
}
