import { applyOperations } from '../../lib/devinarok/js/save/ops.js';
import {
  ApiError, authorize, ensureTables, errorResponse, loadCharacter, onRequestOptions, parseBody,
  publicState, reply, type Env,
} from './_shared';

export { onRequestOptions };

const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await authorize(request, env);
    await ensureTables(env.DB);
    const body = await parseBody(request);
    if (
      typeof body?.characterId !== 'string' || !body.characterId
      || !integer(body.baseRev) || typeof body.uid !== 'string' || !body.uid
    ) throw new ApiError(400, 'invalid-enhancement');
    const current = await loadCharacter(env.DB, userId, body.characterId);
    if (!current) throw new ApiError(404, 'character-not-found');
    if (current.character.rev !== body.baseRev) {
      return reply({ error: 'conflict', ...publicState(current, userId) }, 409);
    }
    const item = current.items.find((candidate) => candidate.uid === body.uid);
    if (!item) throw new ApiError(422, 'item-not-found');
    const roll = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    const itemMap = Object.fromEntries(current.items.map((candidate) => [candidate.uid, candidate]));
    const next = applyOperations(current.character, itemMap, [
      { type: 'enhanceItem', uid: body.uid, roll },
    ], body.characterId);
    next.character.rev = current.character.rev + 1;
    const nextItem = next.items[body.uid];
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE devinarok_items SET data_json = ? WHERE uid = ? AND user_id = ? AND char_id = ?
        AND EXISTS (SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ? AND rev = ?)`)
        .bind(JSON.stringify(nextItem), body.uid, userId, body.characterId, userId, body.characterId, body.baseRev),
      env.DB.prepare(`UPDATE devinarok_characters SET rev = ?, level = ?, xp = ?, gold = ?,
        debug_used = MAX(debug_used, ?), data_json = ?, updated_at = ?
        WHERE user_id = ? AND char_id = ? AND rev = ?`)
        .bind(next.character.rev, next.character.level, next.character.xp, next.character.gold,
          Number(next.character.debugUsed), JSON.stringify(next.character), new Date().toISOString(),
          userId, body.characterId, body.baseRev),
    ]);
    if (Number(results.at(-1)?.meta?.changes ?? 0) !== 1) {
      const latest = await loadCharacter(env.DB, userId, body.characterId);
      return reply({ error: 'conflict', ...(latest ? publicState(latest, userId) : {}) }, 409);
    }
    const saved = await loadCharacter(env.DB, userId, body.characterId);
    if (!saved) throw new ApiError(500, 'save-failed');
    return reply({ ...publicState(saved, userId), success: nextItem.enhance > item.enhance, roll });
  } catch (error) { return errorResponse(error); }
};
