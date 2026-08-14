// /api/voicematch/request-status — 유저가 낸 가수추가 요청의 처리 상태 조회구.
// 클라가 요청 성공 시 받은 id를 localStorage에 쌓아두고, 재방문 때 이 엔드포인트로 묶어서 물어본다.
// done이면 "요청하신 OO 추가됐습니다" 토스트를 띄우는 용도. 시크릿 없이 열려 있고,
// 노출하는 건 artist/status/done_at 뿐이다(ip_hash·note 등 내부 필드는 내보내지 않는다).
// id는 순차 증가라 임의 조회가 가능하지만, 어차피 요청한 가수 이름은 공개 정보라 민감도가 없다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  const raw = new URL(ctx.request.url).searchParams.get('ids') || '';
  const ids = raw.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, 20);
  if (!ids.length) return Response.json({ requests: [] }, { headers: CORS });

  const holes = ids.map(() => '?').join(',');
  const rows = await ctx.env.DB.prepare(
    `SELECT id, artist, status, done_at FROM voicematch_requests WHERE id IN (${holes})`
  ).bind(...ids).all();

  return Response.json({ requests: rows.results }, {
    headers: { ...CORS, 'Cache-Control': 'no-store' },
  });
};
