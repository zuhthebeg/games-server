import { ensureTable } from '../arpg/character';
import { ensureCountryColumn } from './_rank_utils';
interface Env { DB: D1Database }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization' };
export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers });
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    await ensureTable(env.DB); await ensureCountryColumn(env.DB);
    const rows = await env.DB.prepare(`SELECT c.user_id,c.char_id,c.data,c.level,c.power,c.progress,u.nickname,u.country FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY level DESC, progress DESC, power DESC) AS own_rank FROM arpg_characters) c LEFT JOIN users u ON u.id=c.user_id WHERE c.own_rank=1 ORDER BY c.level DESC,c.progress DESC,c.power DESC LIMIT 50`).all();
    return Response.json({ rankings: (rows.results || []).map((r: any, index: number) => { const data = JSON.parse(r.data); const stage = Object.keys(data.cleared || {}).filter(id => /^S\d+$/.test(id) && data.cleared[id]).sort((a,b) => Number(b.slice(1))-Number(a.slice(1)))[0] || null; return { rank: index + 1, userId: r.user_id, charId: r.char_id, nickname: r.nickname || `익명#${String(r.user_id).slice(-6)}`, country: r.country || null, level: r.level, stage, power: r.power }; }) }, { headers });
  } catch (error) { console.error(error); return Response.json({ error: 'server_error' }, { status: 500, headers }); }
};
