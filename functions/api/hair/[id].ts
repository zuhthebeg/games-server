// GET /api/hair/:id — Get analysis detail
interface Env { DB: D1Database; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = params.id as string;
  const row = await env.DB.prepare('SELECT * FROM hairstyles WHERE id = ?').bind(id).first();
  if (!row) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS });
  await env.DB.prepare('UPDATE hairstyles SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify(row), { headers: CORS });
};
