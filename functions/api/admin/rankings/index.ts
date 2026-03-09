/**
 * GET  /api/admin/rankings  — 전체 설정 조회
 */
import { settleIfDue } from '../../rankings/_rank_utils';

const ADMIN_SECRET = 'cocy-admin-2026';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }
  const rows = await env.DB.prepare('SELECT * FROM rank_configs ORDER BY rank_type').all();
  return Response.json({ configs: rows.results ?? [] }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
