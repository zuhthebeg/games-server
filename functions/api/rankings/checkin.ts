/**
 * GET /api/rankings/checkin
 * 로그인 유저 접속 시 호출
 * - 날짜 바뀌면 전 시즌 정산 실행
 * - 내 상금 목록 반환 (팝업용)
 */
import { CORS, settleIfDue, todayKST } from './_rank_utils';

interface Env { DB: D1Database }

async function getAuth(request: Request, DB: D1Database) {
  const auth = request.headers.get('Authorization') ?? '';
  const userId = auth.replace('Bearer ', '').trim();
  if (!userId) return null;
  const user = await DB.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(userId).first<{ id: string; nickname: string }>();
  return user ?? null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { DB } = env;

  const user = await getAuth(request, DB);
  if (!user) {
    return Response.json({ settled: false, rewards: [] }, { headers: CORS });
  }

  const today = todayKST();

  // 마지막 방문일 확인
  const userData = await DB.prepare('SELECT updated_at FROM user_data WHERE user_id = ?').bind(user.id).first<{ updated_at: string }>();
  const lastVisit = userData?.updated_at?.slice(0, 10) ?? '';

  let rewards: { rank_type: string; rank: number; score: number; gold: number }[] = [];

  if (lastVisit !== today) {
    // 날짜 바뀜 → 정산
    const results = await settleIfDue(DB);
    for (const r of results) {
      const mine = r.rewarded.find(w => w.user_id === user.id);
      if (mine) {
        // 이 유저에게 지급된 골드 확인
        const log = await DB.prepare(
          `SELECT gold FROM rank_reward_log WHERE rank_type = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`
        ).bind(r.rank_type, user.id).first<{ gold: number }>();
        rewards.push({ rank_type: r.rank_type, rank: mine.rank, score: mine.score, gold: log?.gold ?? 0 });
      }
    }

    // 방문일 갱신
    await DB.prepare(`
      INSERT INTO user_data (user_id, gold, data, updated_at) VALUES (?, 0, '{}', datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET updated_at = datetime('now')
    `).bind(user.id).run();
  }

  // 현재 골드 잔액
  const wallet = await DB.prepare('SELECT gold FROM user_data WHERE user_id = ?').bind(user.id).first<{ gold: number }>();

  return Response.json({
    settled: rewards.length > 0,
    rewards,
    gold: wallet?.gold ?? 0,
  }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
