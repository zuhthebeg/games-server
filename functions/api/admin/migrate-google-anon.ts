// POST /api/admin/migrate-google-anon — 구글 인증 계정인데 is_anonymous=1로 남은 과거 가입분 일괄 교정.
// 원인: google/signin.ts가 INSERT/UPDATE에서 is_anonymous를 안 건드려서 구글 계정이 익명 취급 →
// voicematch 등 등록계정 전용 랭킹 제출이 403으로 조용히 실패. 멱등이라 반복 호출 무해.
const ADMIN_SECRET = 'cocy-admin-2026-r1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET)
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  const res = await ctx.env.DB.prepare(
    'UPDATE users SET is_anonymous = 0 WHERE is_anonymous = 1 AND google_id IS NOT NULL').run();
  return Response.json({ ok: true, fixed: res.meta.changes }, { headers: CORS });
};
