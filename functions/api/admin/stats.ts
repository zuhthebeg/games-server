// 어드민 대시보드 News 서비스 카드 — 뉴스 팩트체크 지표 전용.
// 게임별 지표는 /api/admin/game-stats (어드민 각 게임 페이지에서 사용).
const ADMIN_SECRET = 'cocy-admin-2026-r1';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = ctx.env.DB;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const [factchecks, reviews, journalists, avgScore, fcToday, fcWeek, fcMonth] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM news_factcheck WHERE result_type = 'factcheck'`).first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as cnt FROM news_factcheck WHERE result_type = 'review'`).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_journalists').first<{ cnt: number }>(),
    db.prepare(`SELECT ROUND(AVG(score), 1) as avg FROM news_factcheck WHERE score IS NOT NULL`).first<{ avg: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?').bind(today).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?').bind(weekAgo).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?').bind(monthAgo).first<{ cnt: number }>(),
  ]);

  return Response.json({
    service: 'news',
    name: 'News',
    icon: '📰',
    updatedAt: now.toISOString(),
    metrics: [
      { label: '팩트체크 기사', value: factchecks?.cnt ?? 0 },
      { label: '헤드라인 리뷰', value: reviews?.cnt ?? 0 },
      { label: '분석된 기자', value: journalists?.cnt ?? 0 },
      { label: '평균 신뢰도', value: avgScore?.avg ?? 0 },
    ],
    growth: [
      { label: '오늘 분석', value: fcToday?.cnt ?? 0 },
      { label: '7일 분석', value: fcWeek?.cnt ?? 0 },
      { label: '30일 분석', value: fcMonth?.cnt ?? 0 },
    ],
  }, { headers: { 'Access-Control-Allow-Origin': '*' } });
};

export const onRequestOptions = () =>
  new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }});
