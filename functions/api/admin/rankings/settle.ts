/**
 * POST /api/admin/rankings/settle  — 수동 정산
 */
import { settleIfDue } from '../../rankings/_rank_utils';

const ADMIN_SECRET = 'cocy-admin-2026';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Env { DB: D1Database }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  const body = await request.json<{ rank_type?: string }>().catch(() => ({}));

  if (body.rank_type) {
    await env.DB.prepare(
      `UPDATE rank_configs SET next_reset_at = datetime('now') WHERE rank_type = ?`
    ).bind(body.rank_type).run();
  } else {
    await env.DB.prepare(`UPDATE rank_configs SET next_reset_at = datetime('now') WHERE enabled = 1`).run();
  }

  const results = await settleIfDue(env.DB);
  return Response.json({ ok: true, settled: results }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
