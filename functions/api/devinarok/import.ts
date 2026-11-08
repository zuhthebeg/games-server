import { validateImport } from '../../lib/devinarok/validation';
import {
  ApiError, authorize, ensureTables, errorResponse, loadCharacter, onRequestOptions, parseBody,
  publicState, reply, storeImported, type Env,
} from './_shared';

export { onRequestOptions };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await authorize(request, env);
    await ensureTables(env.DB);
    const imported = validateImport(await parseBody(request, 256 * 1024));
    const existing = await loadCharacter(env.DB, userId, imported.character.id);
    if (existing) throw new ApiError(409, 'character-exists');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devinarok_characters WHERE user_id = ?')
      .bind(userId).first<{ n: number }>();
    if (Number(count?.n ?? 0) >= 6) throw new ApiError(409, 'character-limit');
    const character = await storeImported(env.DB, userId, imported);
    return reply(publicState({ character, items: imported.items }, userId), 201);
  } catch (error) { return errorResponse(error); }
};
