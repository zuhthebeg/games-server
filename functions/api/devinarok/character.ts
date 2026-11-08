import {
  authorize, ensureTables, errorResponse, onRequestOptions, parseBody, reply, type Env, ApiError,
} from './_shared';

export { onRequestOptions };

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await authorize(request, env);
    await ensureTables(env.DB);
    const body = await parseBody(request);
    if (typeof body?.characterId !== 'string' || !body.characterId) throw new ApiError(400, 'invalid-character');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM devinarok_items WHERE user_id = ? AND char_id = ?').bind(userId, body.characterId),
      env.DB.prepare('DELETE FROM devinarok_ledger WHERE user_id = ? AND char_id = ?').bind(userId, body.characterId),
      env.DB.prepare('DELETE FROM devinarok_characters WHERE user_id = ? AND char_id = ?').bind(userId, body.characterId),
    ]);
    return reply({ ok: true });
  } catch (error) { return errorResponse(error); }
};
