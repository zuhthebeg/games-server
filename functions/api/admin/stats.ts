const ADMIN_SECRET = 'cocy-admin-2026';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = ctx.env.DB;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const REAL_USER = `email NOT LIKE 'test_%' AND email IS NOT NULL`;

  const [
    totalUsers, fchecks, journalists,
    linerushPlayers, linerushBest,
    bossKills, pvpGames, weaponPlayers,
    fcWeek, fcMonth,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${REAL_USER}`).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_factcheck').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_journalists').first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM rankings WHERE linerush_best_stage > 0`).first<{ cnt: number }>(),
    db.prepare(`SELECT MAX(linerush_best_stage) as best FROM rankings`).first<{ best: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM boss_encounters`).first<{ cnt: number }>(),
    db.prepare(`SELECT SUM(pvp_wins + pvp_losses) as cnt FROM rankings`).first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM rankings WHERE best_weapon_level > 0`).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?").bind(weekAgo).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?").bind(monthAgo).first<{ cnt: number }>(),
  ]);

  return Response.json({
    service: 'relay',
    name: 'Games & News',
    icon: '🎮',
    updatedAt: now.toISOString(),
    metrics: [
      { label: '총 유저', value: totalUsers?.cnt ?? 0 },
      { label: '팩트체크', value: fchecks?.cnt ?? 0 },
      { label: '분석된 기자', value: journalists?.cnt ?? 0 },
    ],
    growth: [
      { label: '7일 팩트체크', value: fcWeek?.cnt ?? 0 },
      { label: '30일 팩트체크', value: fcMonth?.cnt ?? 0 },
    ],
    games: [
      {
        id: 'linerush',
        name: '🏃 Line Rush (땅따먹기)',
        status: 'testing',
        metrics: [
          { label: '플레이어', value: linerushPlayers?.cnt ?? 0 },
          { label: '최고 스테이지', value: linerushBest?.best ?? 0 },
        ],
      },
      {
        id: 'weapon',
        name: '⚔️ 무기강화',
        status: 'testing',
        metrics: [
          { label: '보스 처치', value: bossKills?.cnt ?? 0 },
          { label: 'PvP 게임', value: pvpGames?.cnt ?? 0 },
          { label: '강화 유저', value: weaponPlayers?.cnt ?? 0 },
        ],
      },
    ],
  }, { headers: { 'Access-Control-Allow-Origin': '*' } });
};

export const onRequestOptions = () =>
  new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }});
