/**
 * GET /api/rankings/checkin
 * 로그인 유저 접속 시 호출
 * - 날짜 바뀌면 전 시즌 정산 실행
 * - 내 상금 목록 반환 (팝업용)
 */
import { CORS, settleIfDue, todayKST, RANK_TYPES } from './_rank_utils';
import type { RankType } from './_rank_utils';

interface Env { DB: D1Database }

async function ensureCheckinTable(DB: D1Database) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS rank_checkin (
      user_id TEXT NOT NULL,
      rank_type TEXT NOT NULL,
      check_date TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, rank_type)
    )
  `).run();
}

async function getAuth(request: Request, DB: D1Database) {
  const auth = request.headers.get('Authorization') ?? '';
  const userId = auth.replace('Bearer ', '').trim();
  if (!userId) return null;
  // 로그인 회원 기준 (email 존재)
  const user = await DB.prepare('SELECT id, nickname, email FROM users WHERE id = ?').bind(userId).first<{ id: string; nickname: string; email: string | null }>();
  if (!user?.email) return null;
  return user;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { DB } = env;
  await ensureCheckinTable(DB);

  const url = new URL(request.url);
  const rankType = (url.searchParams.get('type') || '') as RankType;
  if (!RANK_TYPES.includes(rankType)) {
    return Response.json({ settled: false, rewards: [], error: 'invalid type' }, { status: 400, headers: CORS });
  }

  const user = await getAuth(request, DB);
  if (!user) {
    return Response.json({ settled: false, rewards: [], reason: 'members_only' }, { headers: CORS });
  }

  // 정산 필요 시 먼저 실행
  await settleIfDue(DB);

  const today = todayKST();

  // 탭별 첫 방문 체크
  const checkin = await DB.prepare(
    'SELECT check_date FROM rank_checkin WHERE user_id = ? AND rank_type = ?'
  ).bind(user.id, rankType).first<{ check_date: string }>();

  const firstVisitToday = checkin?.check_date !== today;
  if (firstVisitToday) {
    await DB.prepare(`
      INSERT INTO rank_checkin (user_id, rank_type, check_date, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, rank_type) DO UPDATE SET check_date = excluded.check_date, updated_at = datetime('now')
    `).bind(user.id, rankType, today).run();
  }

  // 최근 보상 로그 — firstVisitToday 관계없이 항상 반환 (클라이언트가 seen 여부 판단)
  const row = await DB.prepare(`
    SELECT rank_type, rank, score, gold, period_date
    FROM rank_reward_log
    WHERE user_id = ? AND rank_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(user.id, rankType).first<any>();
  const reward = row ?? null;

  const wallet = await DB.prepare('SELECT gold FROM user_data WHERE user_id = ?').bind(user.id).first<{ gold: number }>();

  return Response.json({
    reward,          // 최근 지급 기록 (null이면 보상 없음)
    gold: wallet?.gold ?? 0,
  }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
