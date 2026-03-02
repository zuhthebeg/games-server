// GET /api/hair/gallery — Grouped by style_name_ko
interface Env { DB: D1Database; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(+(url.searchParams.get('limit') || 50), 100);

  let rows;
  if (q) {
    rows = await env.DB.prepare(
      'SELECT id, style_name_ko, style_name_en, length, texture, color, difficulty, gguan_ggyu_score, image_key, view_count, created_at FROM hairstyles WHERE style_name_ko LIKE ? OR style_name_en LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).bind('%'+q+'%', '%'+q+'%', limit).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT id, style_name_ko, style_name_en, length, texture, color, difficulty, gguan_ggyu_score, image_key, view_count, created_at FROM hairstyles ORDER BY created_at DESC LIMIT ?'
    ).bind(limit).all();
  }

  // Group by style_name_ko
  const groups: Record<string, any[]> = {};
  for (const r of (rows.results || [])) {
    const key = (r as any).style_name_ko || '미분류';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  return new Response(JSON.stringify({ groups, total: rows.results?.length || 0 }), { headers: CORS });
};
