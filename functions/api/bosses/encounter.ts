// POST /api/bosses/encounter — 보스 만남 기록
// Body: { player_id, boss_id, game_id, result, stage?, score?, detail? }

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await request.json() as any;
    const { player_id, boss_id, game_id, result, stage, score, detail } = body;

    if (!player_id || !boss_id || !game_id || !result) {
      return new Response(JSON.stringify({ error: 'Missing required fields: player_id, boss_id, game_id, result' }), { status: 400, headers });
    }

    // 유효한 result 값 체크
    const validResults = ['killed', 'escaped', 'lost', 'talked', 'fled'];
    if (!validResults.includes(result)) {
      return new Response(JSON.stringify({ error: `Invalid result. Use: ${validResults.join(', ')}` }), { status: 400, headers });
    }

    await env.DB.prepare(
      'INSERT INTO boss_player_history (player_id, boss_id, game_id, result, stage, score, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(player_id, boss_id, game_id, result, stage || null, score || null, detail ? JSON.stringify(detail) : null).run();

    // FIFO: 플레이어당 보스당 최근 50개만 유지
    await env.DB.prepare(
      `DELETE FROM boss_player_history WHERE id NOT IN (
        SELECT id FROM boss_player_history WHERE player_id = ? AND boss_id = ? ORDER BY created_at DESC LIMIT 50
      ) AND player_id = ? AND boss_id = ?`
    ).bind(player_id, boss_id, player_id, boss_id).run();

    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
