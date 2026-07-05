// POST /api/admin/bot-reclassify — 봇/사람 분류 재실행 (멱등).
// 규칙: ① 활동 흔적(가입/닉네임/랭킹/게임데이터/재방문) → human 승급
//       ② 같은 분(minute)에 5개+ 생성된 무활동 익명 → bot (정기 크롤러 버스트)
//       ③ 나머지 미분류 → suspect
// '수동 지정'(어드민에서 직접 바꾼 것)은 건드리지 않는다.
const ADMIN_SECRET = 'cocy-admin-2026';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }
  const db = ctx.env.DB;
  const NOT_MANUAL = `(bot_reason IS NULL OR bot_reason NOT LIKE '수동%')`;

  const human = await db.prepare(`
    UPDATE users SET bot_status='human', bot_reason=CASE
        WHEN is_anonymous=0 OR email IS NOT NULL OR google_id IS NOT NULL THEN '가입 계정'
        WHEN nickname IS NOT NULL THEN '닉네임 설정'
        WHEN id IN (SELECT user_id FROM rankings) THEN '랭킹 기록'
        WHEN id IN (SELECT DISTINCT user_id FROM user_data) THEN '게임 데이터'
        ELSE '재방문' END
    WHERE ${NOT_MANUAL} AND (bot_status IS NULL OR bot_status != 'human') AND (
      is_anonymous=0 OR email IS NOT NULL OR google_id IS NOT NULL OR nickname IS NOT NULL
      OR last_seen_at > created_at
      OR id IN (SELECT user_id FROM rankings)
      OR id IN (SELECT DISTINCT user_id FROM user_data)
    )`).run();

  const bot = await db.prepare(`
    UPDATE users SET bot_status='bot', bot_reason='burst_signup(정기 크롤러 03:xx UTC)'
    WHERE ${NOT_MANUAL} AND (bot_status IS NULL OR bot_status = 'suspect')
      AND is_anonymous=1 AND email IS NULL AND google_id IS NULL AND nickname IS NULL
      AND (last_seen_at IS NULL OR last_seen_at = created_at)
      AND id NOT IN (SELECT user_id FROM rankings)
      AND id NOT IN (SELECT DISTINCT user_id FROM user_data)
      AND strftime('%Y-%m-%d %H:%M', created_at) IN (
        SELECT strftime('%Y-%m-%d %H:%M', created_at) FROM users GROUP BY 1 HAVING COUNT(*) >= 5
      )`).run();

  const suspect = await db.prepare(
    `UPDATE users SET bot_status='suspect', bot_reason='익명·무활동 단발 방문' WHERE bot_status IS NULL`
  ).run();

  const dist = await db.prepare(
    `SELECT bot_status, COUNT(*) AS cnt FROM users GROUP BY bot_status`
  ).all();

  return Response.json({
    ok: true,
    changed: { human: human.meta.changes, bot: bot.meta.changes, suspect: suspect.meta.changes },
    distribution: Object.fromEntries((dist.results as any[]).map(r => [r.bot_status ?? 'null', r.cnt])),
  }, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
