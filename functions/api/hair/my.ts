import { verifyJWT, extractBearerToken } from '../../lib/auth';
interface Env { DB: D1Database; JWT_SECRET: string; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', 'Content-Type': 'application/json' };

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) return new Response(JSON.stringify({ error: '로그인 필요' }), { status: 401, headers: CORS });
  
  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) throw new Error('invalid');
    const rows = await env.DB.prepare(
      'SELECT id, style_name_ko, style_name_en, gguan_ggyu_score, image_key, created_at FROM hairstyles WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(payload.sub).all();
    return new Response(JSON.stringify({ items: rows.results || [] }), { headers: CORS });
  } catch {
    return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers: CORS });
  }
};
