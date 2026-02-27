// GET /api/bosses — 보스 레지스트리 목록
// GET /api/bosses?boss_id=slime — 특정 보스 정보 + 플레이어 히스토리

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const bossId = url.searchParams.get('boss_id');
  const playerId = url.searchParams.get('player_id');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (bossId) {
    // 특정 보스 정보
    const boss = await env.DB.prepare('SELECT * FROM bosses WHERE boss_id = ?').bind(bossId).first();
    if (!boss) return new Response(JSON.stringify({ error: 'Boss not found' }), { status: 404, headers });

    let history: any[] = [];
    let encounterCount = 0;
    if (playerId) {
      const hist = await env.DB.prepare(
        'SELECT game_id, result, stage, score, created_at FROM boss_player_history WHERE boss_id = ? AND player_id = ? ORDER BY created_at DESC LIMIT 10'
      ).bind(bossId, playerId).all();
      history = hist.results || [];
      
      const countResult = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM boss_player_history WHERE boss_id = ? AND player_id = ?'
      ).bind(bossId, playerId).first();
      encounterCount = (countResult as any)?.cnt || 0;
    }

    return new Response(JSON.stringify({ boss, history, encounterCount }), { headers });
  }

  // 전체 목록
  const all = await env.DB.prepare('SELECT boss_id, name, name_en, origin_game, tier, catchphrase, color FROM bosses ORDER BY tier, boss_id').all();
  return new Response(JSON.stringify({ bosses: all.results }), { headers });
};
