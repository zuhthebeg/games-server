// 게임별 지표 — 어드민 registry.json의 게임 id를 키로 반환. 각 게임 상세 페이지에서 표시.
const ADMIN_SECRET = 'cocy-admin-2026-r1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  const db = ctx.env.DB;
  const [linerushPlayers, linerushBest, bossKills, pvpGames, weaponPlayers] = await Promise.all([
    db.prepare('SELECT COUNT(*) as cnt FROM rankings WHERE linerush_best_stage > 0').first<{ cnt: number }>(),
    db.prepare('SELECT MAX(linerush_best_stage) as best FROM rankings').first<{ best: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM boss_encounters').first<{ cnt: number }>(),
    db.prepare('SELECT SUM(pvp_wins + pvp_losses) as cnt FROM rankings').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM rankings WHERE best_weapon_level > 0').first<{ cnt: number }>(),
  ]);

  return Response.json({
    updatedAt: new Date().toISOString(),
    games: {
      linerush: {
        metrics: [
          { label: '플레이어', value: linerushPlayers?.cnt ?? 0 },
          { label: '최고 스테이지', value: linerushBest?.best ?? 0 },
        ],
      },
      enhance: {
        metrics: [
          { label: '보스 처치', value: bossKills?.cnt ?? 0 },
          { label: 'PvP 게임', value: pvpGames?.cnt ?? 0 },
          { label: '강화 유저', value: weaponPlayers?.cnt ?? 0 },
        ],
      },
    },
  }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
