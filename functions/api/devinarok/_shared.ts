import { extractBearerToken, verifyJWT } from '../../lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string }

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });
export const onRequestOptions = async () => new Response(null, { status: 204, headers: HEADERS });

export async function ensureTables(DB: D1Database) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS devinarok_characters (
    user_id TEXT NOT NULL, char_id TEXT NOT NULL, rev INTEGER NOT NULL, level INTEGER NOT NULL,
    xp INTEGER NOT NULL, gold INTEGER NOT NULL, debug_used INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_settlement_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, char_id)
  )`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS devinarok_items (
    user_id TEXT NOT NULL, uid TEXT NOT NULL, char_id TEXT NOT NULL, data_json TEXT NOT NULL,
    PRIMARY KEY (user_id, uid)
  )`).run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_devinarok_items_character ON devinarok_items(user_id, char_id)').run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS devinarok_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, char_id TEXT NOT NULL,
    rev INTEGER NOT NULL, idem_key TEXT, ops_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (char_id, idem_key)
  )`).run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_devinarok_ledger_user_created ON devinarok_ledger(user_id, created_at)').run();
}

export async function authorize(request: Request, env: Env) {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) throw new ApiError(401, 'unauthorized');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload?.sub) throw new ApiError(401, 'unauthorized');
  if (payload.isAnonymous === true) throw new ApiError(403, 'login-required');
  const user = await env.DB.prepare('SELECT id, is_anonymous FROM users WHERE id = ?')
    .bind(payload.sub).first<{ id: string; is_anonymous: number }>();
  if (!user) throw new ApiError(401, 'unauthorized');
  if (Number(user.is_anonymous) === 1) throw new ApiError(403, 'login-required');
  return String(payload.sub);
}

export async function parseBody(request: Request, limit = 16 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > limit) throw new ApiError(413, 'payload-too-large');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'invalid-json'); }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return reply({ error: error.code }, error.status);
  if (error instanceof TypeError || error instanceof RangeError) return reply({ error: error.message }, 422);
  return reply({ error: 'server-error' }, 500);
}

export async function loadCharacter(DB: D1Database, userId: string, charId: string) {
  const row = await DB.prepare(`SELECT rev, debug_used, data_json, last_settlement_at
    FROM devinarok_characters WHERE user_id = ? AND char_id = ?`).bind(userId, charId)
    .first<{ rev: number; debug_used: number; data_json: string; last_settlement_at: number }>();
  if (!row) return null;
  const itemRows = await DB.prepare('SELECT data_json FROM devinarok_items WHERE user_id = ? AND char_id = ?')
    .bind(userId, charId).all<{ data_json: string }>();
  const character = JSON.parse(row.data_json);
  character.rev = row.rev;
  character.debugUsed = Number(row.debug_used) === 1 || character.debugUsed === true;
  return {
    character,
    items: (itemRows.results ?? []).map(({ data_json }) => JSON.parse(data_json)),
    lastSettlementAt: Number(row.last_settlement_at) || 0,
  };
}

export function publicState(state: { character: any; items: any[] }, userId: string) {
  return { character: { ...state.character, cloudUserId: userId }, items: state.items };
}

function itemStatements(DB: D1Database, userId: string, charId: string, items: any[], guardRev: number) {
  const guard = `EXISTS (SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ? AND rev = ?)`;
  return [
    DB.prepare(`DELETE FROM devinarok_items WHERE user_id = ? AND char_id = ? AND ${guard}`)
      .bind(userId, charId, userId, charId, guardRev),
    ...items.map((item) => DB.prepare(`INSERT INTO devinarok_items (uid, user_id, char_id, data_json)
      SELECT ?, ?, ?, ? WHERE ${guard}`)
      .bind(item.uid, userId, charId, JSON.stringify(item), userId, charId, guardRev)),
  ];
}

export async function storeCommit(
  DB: D1Database,
  userId: string,
  state: { character: any; items: any[] },
  { baseRev, idempotencyKey, ops, debugUsed, settlementAt = 0 }: {
    baseRev: number; idempotencyKey: string; ops: any[]; debugUsed: boolean; settlementAt?: number | null;
  },
) {
  const character = { ...state.character, rev: baseRev + 1, debugUsed };
  const now = new Date().toISOString();
  const update = DB.prepare(`UPDATE devinarok_characters SET rev = ?, level = ?, xp = ?, gold = ?,
    debug_used = MAX(debug_used, ?), data_json = ?, updated_at = ?,
    last_settlement_at = CASE WHEN ? IS NULL THEN last_settlement_at ELSE ? END
    WHERE user_id = ? AND char_id = ? AND rev = ?`)
    .bind(character.rev, character.level, character.xp, character.gold, Number(debugUsed),
      JSON.stringify(character), now, settlementAt, settlementAt, userId, character.id, baseRev);
  const ledger = DB.prepare(`INSERT INTO devinarok_ledger (user_id, char_id, rev, idem_key, ops_json)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ? AND rev = ?
    )`).bind(userId, character.id, character.rev, idempotencyKey, JSON.stringify(ops),
      userId, character.id, baseRev);
  const results = await DB.batch([
    ...itemStatements(DB, userId, character.id, state.items, baseRev),
    ledger,
    update,
  ]);
  return Number(results.at(-1)?.meta?.changes ?? 0) === 1;
}

export async function storeCreated(
  DB: D1Database,
  userId: string,
  state: { character: any; items: any[] },
  idempotencyKey: string,
  ops: any[],
) {
  const character = { ...state.character, rev: 1 };
  const now = new Date().toISOString();
  const inserts = [
    DB.prepare(`INSERT INTO devinarok_characters
      (user_id, char_id, rev, level, xp, gold, debug_used, data_json, updated_at)
      SELECT ?, ?, 1, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM devinarok_characters WHERE user_id = ?) < 6`)
      .bind(userId, character.id, character.level, character.xp, character.gold,
        Number(character.debugUsed), JSON.stringify(character), now, userId),
    ...state.items.map((item) => DB.prepare(`INSERT INTO devinarok_items
      (uid, user_id, char_id, data_json) SELECT ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ? AND rev = 1)`)
      .bind(item.uid, userId, character.id, JSON.stringify(item), userId, character.id)),
    DB.prepare(`INSERT INTO devinarok_ledger (user_id, char_id, rev, idem_key, ops_json)
      SELECT ?, ?, 1, ?, ? WHERE EXISTS (
        SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ? AND rev = 1
      )`).bind(userId, character.id, idempotencyKey, JSON.stringify(ops), userId, character.id),
  ];
  const results = await DB.batch(inserts);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new ApiError(409, 'character-limit-or-conflict');
  return character;
}

export async function storeImported(
  DB: D1Database, userId: string, state: { character: any; items: any[] },
) {
  const character = { ...state.character, rev: Math.max(1, Number(state.character.rev) || 1) };
  const now = new Date().toISOString();
  const insert = DB.prepare(`INSERT INTO devinarok_characters
    (user_id, char_id, rev, level, xp, gold, debug_used, data_json, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
    (SELECT COUNT(*) FROM devinarok_characters WHERE user_id = ?) < 6`)
    .bind(userId, character.id, character.rev, character.level, character.xp, character.gold,
      Number(character.debugUsed), JSON.stringify(character), now, userId);
  const itemInserts = state.items.map((item) => DB.prepare(`INSERT INTO devinarok_items
    (uid, user_id, char_id, data_json)
    SELECT ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM devinarok_characters WHERE user_id = ? AND char_id = ?
    )`).bind(item.uid, userId, character.id, JSON.stringify(item), userId, character.id));
  const results = await DB.batch([insert, ...itemInserts]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new ApiError(409, 'character-limit-or-conflict');
  return character;
}
