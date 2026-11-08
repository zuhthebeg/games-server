import { applyOperations } from '../../lib/devinarok/js/save/ops.js';
import { validateOps } from '../../lib/devinarok/validation';
import {
  ApiError, authorize, ensureTables, errorResponse, loadCharacter, onRequestOptions, parseBody,
  publicState, reply, storeCommit, storeCreated, type Env,
} from './_shared';

export { onRequestOptions };

const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await authorize(request, env);
    await ensureTables(env.DB);
    const body = await parseBody(request);
    if (
      !body || typeof body.characterId !== 'string' || !body.characterId
      || !integer(body.baseRev) || typeof body.idempotencyKey !== 'string'
      || !body.idempotencyKey || body.idempotencyKey.length > 128
      || !Array.isArray(body.ops) || !body.context || typeof body.context !== 'object'
    ) throw new ApiError(400, 'invalid-commit');
    const DB = env.DB;
    const previous = await DB.prepare(`SELECT rev FROM devinarok_ledger
      WHERE user_id = ? AND char_id = ? AND idem_key = ?`)
      .bind(userId, body.characterId, body.idempotencyKey).first<{ rev: number }>();
    if (previous) {
      const state = await loadCharacter(DB, userId, body.characterId);
      if (!state) throw new ApiError(404, 'character-not-found');
      return reply(publicState(state, userId));
    }
    const rate = await DB.prepare(`SELECT COUNT(*) AS n FROM devinarok_ledger
      WHERE user_id = ? AND created_at >= datetime('now', '-60 seconds')`)
      .bind(userId).first<{ n: number }>();
    if (Number(rate?.n ?? 0) >= 60) throw new ApiError(429, 'rate-limit');

    const current = await loadCharacter(DB, userId, body.characterId);
    if ((current && current.character.rev !== body.baseRev) || (!current && body.baseRev !== 0)) {
      return reply({ error: 'conflict', ...(current ? publicState(current, userId) : {}) }, 409);
    }
    const now = Date.now();
    validateOps({
      character: current?.character ?? null,
      items: current?.items ?? [],
      ops: body.ops,
      context: body.context,
      lastSettlementAt: current?.lastSettlementAt ?? 0,
      now,
    });
    const itemMap = Object.fromEntries((current?.items ?? []).map((item) => [item.uid, item]));
    const next = applyOperations(current?.character ?? null, itemMap, body.ops, body.characterId);
    next.character.rev = body.baseRev + 1;
    next.character.debugUsed = current?.character.debugUsed === true || body.context.kind === 'debug';
    const nextState = { character: next.character, items: Object.values(next.items) };

    if (!current) {
      await storeCreated(DB, userId, nextState, body.idempotencyKey, body.ops);
    } else {
      const stored = await storeCommit(DB, userId, nextState, {
        baseRev: body.baseRev,
        idempotencyKey: body.idempotencyKey,
        ops: body.ops,
        debugUsed: next.character.debugUsed,
        settlementAt: body.context.kind === 'settlement' ? now : null,
      });
      if (!stored) {
        const raced = await DB.prepare(`SELECT rev FROM devinarok_ledger
          WHERE user_id = ? AND char_id = ? AND idem_key = ?`)
          .bind(userId, body.characterId, body.idempotencyKey).first<{ rev: number }>();
        if (raced) {
          const state = await loadCharacter(DB, userId, body.characterId);
          if (!state) throw new ApiError(404, 'character-not-found');
          return reply(publicState(state, userId));
        }
        const latest = await loadCharacter(DB, userId, body.characterId);
        return reply({ error: 'conflict', ...(latest ? publicState(latest, userId) : {}) }, 409);
      }
    }
    const state = await loadCharacter(DB, userId, body.characterId);
    if (!state) throw new ApiError(500, 'save-failed');
    return reply(publicState(state, userId));
  } catch (error) { return errorResponse(error); }
};
