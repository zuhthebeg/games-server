// GET /api/hair/image/:id — Serve mosaic image from R2
interface Env { HAIR_BUCKET: R2Bucket; }
const CORS = { 'Access-Control-Allow-Origin': '*' };

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = params.id as string;
  const obj = await env.HAIR_BUCKET.get('hair/' + id + '.jpg');
  if (!obj) return new Response('Not found', { status: 404, headers: CORS });
  return new Response(obj.body, { headers: { ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' } });
};
