import { verifyJWT, extractBearerToken } from '../../lib/auth';
import { updateUserCountry, extractCountry, ensureCountryColumn } from '../rankings/_rank_utils';

interface Env { DB: D1Database; JWT_SECRET: string }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });
const stages = new Set([...Array.from({ length: 57 }, (_, i) => `S${i + 1}`), 'TD1', 'D_EMBER', 'D_FROST', 'D_VENOM', 'M_MINE_CART', 'M_MARSH_MARKERS', 'M_THRONE_GARGOYLE']);
const integer = (v: unknown, min = 0, max = 1e9) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export async function ensureTable(DB: D1Database) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS arpg_characters (user_id TEXT NOT NULL, char_id TEXT NOT NULL, data TEXT NOT NULL, level INTEGER NOT NULL, power INTEGER NOT NULL, progress INTEGER NOT NULL, save_version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,char_id))`).run();
}
export function metrics(data: Record<string, any>) {
  const gear = Object.values(data.equipped || {}).map((uid: any) => data.items?.find((i: any) => i.uid === uid)).filter(Boolean) as any[];
  const weapon = gear.find(i => i.uid === data.equipped.weapon);
  const attack = (data.stats?.str || 0) + (data.stats?.int || 0) + (weapon?.enhance || 0) * 5;
  const defense = (data.stats?.con || 0) + gear.filter(i => i !== weapon).reduce((n, i) => n + 2 + (i.enhance || 0) * 2, 0);
  const speed = (data.stats?.agi || 0);
  return Math.round(attack * 2 + defense * 1.5 + speed);
}
function valid(data: any) {
  if (!object(data) || data.v !== 1 || !['human', 'skeleton_knight'].includes(data.charId)
      || data.charId !== (data.lineage || 'human') || data.version !== 5 || !integer(data.level, 1, 30)
      || !integer(data.xp, 0, 10000) || !integer(data.gold) || !integer(data.createdAt, 0, Number.MAX_SAFE_INTEGER)
      || typeof data.name !== 'string' || data.name.trim() !== data.name || [...data.name].length < 1 || [...data.name].length > 12
      || !object(data.stats) || !['str','agi','int','wis','con','luk','cha'].every(k => integer(data.stats[k], 10, 1000))
      || !object(data.cleared) || !object(data.stageThreat) || !object(data.equipped) || !Array.isArray(data.items)
      || !data.items.some((i: any) => i.uid === data.equipped.weapon)
      || !Object.entries(data.cleared).every(([id, v]) => stages.has(id) && typeof v === 'boolean')
      || !Object.entries(data.stageThreat).every(([id, v]) => stages.has(id) && integer(v, 0, 3))) return false;
  return data.items.every((i: any) => object(i) && typeof i.uid === 'string' && typeof i.id === 'string' && integer(i.enhance, 0, 30));
}
async function owner(context: EventContext<Env, any, any>) {
  const token = extractBearerToken(context.request.headers.get('Authorization'));
  if (!token) return null;
  const payload = await verifyJWT(token, context.env.JWT_SECRET);
  if (!payload?.sub) return null;
  const user = await context.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(payload.sub).first();
  return user ? payload.sub : null;
}
export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers });
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const userId = await owner(context); if (!userId) return reply({ error: 'unauthorized' }, 401);
    await ensureTable(context.env.DB);
    const rows = await context.env.DB.prepare('SELECT char_id, data, level, power, progress, updated_at FROM arpg_characters WHERE user_id = ?').bind(userId).all();
    return reply({ characters: (rows.results || []).map((r: any) => ({ charId: r.char_id, data: JSON.parse(r.data), level: r.level, power: r.power, progress: r.progress, updatedAt: r.updated_at })) });
  } catch (error) { console.error(error); return reply({ error: 'server_error' }, 500); }
};
export const onRequestPut: PagesFunction<Env> = async context => {
  try {
    const userId = await owner(context); if (!userId) return reply({ error: 'unauthorized' }, 401);
    const raw = await context.request.text(); if (new TextEncoder().encode(raw).length > 8192) return reply({ error: 'too_large' }, 413);
    let data: any; try { data = JSON.parse(raw); } catch { return reply({ error: 'invalid_json' }, 400); }
    if (!valid(data)) return reply({ error: 'invalid_snapshot' }, 400);
    await ensureTable(context.env.DB);
    const DB = context.env.DB;
    const existing = await DB.prepare('SELECT updated_at FROM arpg_characters WHERE user_id = ? AND char_id = ?').bind(userId, data.charId).first<{ updated_at: string }>();
    if (existing && Date.now() - Date.parse(`${existing.updated_at.replace(' ', 'T')}Z`) < 30000) return reply({ error: 'rate_limit' }, 429);
    const count = await DB.prepare('SELECT COUNT(*) AS n FROM arpg_characters WHERE user_id = ?').bind(userId).first<{ n: number }>();
    if (!existing && (count?.n || 0) >= 4) return reply({ error: 'slot_limit' }, 409);
    const progress = Object.entries(data.cleared).filter(([, clear]) => clear).length;
    const power = metrics(data);
    await DB.prepare(`INSERT INTO arpg_characters (user_id,char_id,data,level,power,progress,save_version,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(user_id,char_id) DO UPDATE SET data=excluded.data,level=excluded.level,power=excluded.power,progress=excluded.progress,save_version=excluded.save_version,updated_at=excluded.updated_at`).bind(userId, data.charId, JSON.stringify(data), data.level, power, progress, data.version).run();
    await ensureCountryColumn(DB); await updateUserCountry(DB, userId, extractCountry(context.request));
    return reply({ ok: true, charId: data.charId, level: data.level, power, progress });
  } catch (error) { console.error(error); return reply({ error: 'server_error' }, 500); }
};
