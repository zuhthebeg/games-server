import { verifyJWT, extractBearerToken } from '../../lib/auth';
interface Env { DB: D1Database; HAIR_BUCKET: R2Bucket; JWT_SECRET: string; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = params.id as string;
  const row = await env.DB.prepare('SELECT * FROM hairstyles WHERE id = ?').bind(id).first();
  if (!row) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS });
  await env.DB.prepare('UPDATE hairstyles SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify(row), { headers: CORS });
};

export const onRequestDelete: PagesFunction<Env> = async ({ params, request, env }) => {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) return new Response(JSON.stringify({ error: '로그인 필요' }), { status: 401, headers: CORS });
  
  let userId: string;
  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) throw new Error('invalid');
    userId = payload.sub as string;
  } catch {
    return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers: CORS });
  }

  const id = params.id as string;
  const row = await env.DB.prepare('SELECT user_id, image_key FROM hairstyles WHERE id = ?').bind(id).first() as any;
  if (!row) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS });
  if (row.user_id !== userId) return new Response(JSON.stringify({ error: '본인만 삭제 가능' }), { status: 403, headers: CORS });

  // Delete R2 image
  if (row.image_key) {
    try { await env.HAIR_BUCKET.delete(row.image_key); } catch {}
  }
  // Delete DB record
  await env.DB.prepare('DELETE FROM hairstyles WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ success: true }), { headers: CORS });
};
