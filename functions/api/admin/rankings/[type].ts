/**
 * PUT /api/admin/rankings/:type  — 개별 설정 수정
 */
const ADMIN_SECRET = 'cocy-admin-2026';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
};

interface Env { DB: D1Database }

function calcNextReset(period: string): string {
  const base = new Date();
  if (period === 'weekly') base.setDate(base.getDate() + 7);
  else if (period === 'monthly') base.setMonth(base.getMonth() + 1);
  else base.setDate(base.getDate() + 1);
  return base.toISOString().slice(0, 10) + 'T15:00:00.000Z';
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  if (request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }
  const type = (params as any).type as string;
  const body = await request.json<{ period?: string; gold_reward?: number; top_n?: number; enabled?: number }>();
  const nextReset = body.period ? calcNextReset(body.period) : null;

  await env.DB.prepare(`
    UPDATE rank_configs SET
      period      = COALESCE(?, period),
      gold_reward = COALESCE(?, gold_reward),
      top_n       = COALESCE(?, top_n),
      enabled     = COALESCE(?, enabled),
      next_reset_at = COALESCE(?, next_reset_at),
      updated_at  = datetime('now')
    WHERE rank_type = ?
  `).bind(
    body.period ?? null, body.gold_reward ?? null,
    body.top_n ?? null, body.enabled ?? null,
    nextReset, type
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM rank_configs WHERE rank_type = ?').bind(type).first();
  return Response.json({ ok: true, config: updated }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
