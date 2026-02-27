// GET /api/weapons?player_id=xxx — 플레이어 무기 목록
// POST /api/weapons — 무기 등록/업데이트 (upsert)

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const playerId = url.searchParams.get('player_id');
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!playerId) {
    return new Response(JSON.stringify({ error: 'player_id required' }), { status: 400, headers });
  }

  const weapons = await env.DB.prepare(
    'SELECT * FROM player_weapons WHERE player_id = ? ORDER BY is_main DESC, level DESC'
  ).bind(playerId).all();

  const main = await env.DB.prepare(
    'SELECT * FROM player_weapons WHERE player_id = ? AND is_main = 1 LIMIT 1'
  ).bind(playerId).first();

  return new Response(JSON.stringify({ weapons: weapons.results, mainWeapon: main }), { headers });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const body = await request.json() as any;
    const { player_id, weapon_name, weapon_type, element, level, attack, special, is_main, origin_game } = body;

    if (!player_id || !weapon_name) {
      return new Response(JSON.stringify({ error: 'player_id and weapon_name required' }), { status: 400, headers });
    }

    // is_main=1이면 다른 무기 is_main=0으로
    if (is_main) {
      await env.DB.prepare('UPDATE player_weapons SET is_main = 0 WHERE player_id = ?').bind(player_id).run();
    }

    // Upsert by player_id + weapon_name
    const existing = await env.DB.prepare(
      'SELECT id FROM player_weapons WHERE player_id = ? AND weapon_name = ?'
    ).bind(player_id, weapon_name).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE player_weapons SET weapon_type=?, element=?, level=?, attack=?, special=?, is_main=?, updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND weapon_name=?`
      ).bind(weapon_type || null, element || null, level || 0, attack || 10, special || null, is_main ? 1 : 0, player_id, weapon_name).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO player_weapons (player_id, weapon_name, weapon_type, element, level, attack, special, is_main, origin_game) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(player_id, weapon_name, weapon_type || null, element || null, level || 0, attack || 10, special || null, is_main ? 1 : 0, origin_game || 'weaponup').run();
    }

    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
};
