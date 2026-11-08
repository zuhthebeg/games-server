import {
  authorize, ensureTables, errorResponse, loadCharacter, onRequestOptions, publicState, reply,
  type Env,
} from './_shared';

export { onRequestOptions };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await authorize(request, env);
    await ensureTables(env.DB);
    const rows = await env.DB.prepare('SELECT char_id FROM devinarok_characters WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId).all<{ char_id: string }>();
    const characters = [];
    for (const row of rows.results ?? []) {
      const state = await loadCharacter(env.DB, userId, row.char_id);
      if (state) characters.push(publicState(state, userId));
    }
    return reply({ characters });
  } catch (error) { return errorResponse(error); }
};
