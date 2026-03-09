const ADMIN_SECRET = 'cocy-admin-2026';

export const onRequestGet: PagesFunction<{ USERS_DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = ctx.env.USERS_DB;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const [factchecks, journalists, fcWeek, fcMonth] = await Promise.all([
    db.prepare('SELECT COUNT(*) as cnt FROM news_factcheck').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM news_journalists').first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?").bind(weekAgo).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM news_factcheck WHERE created_at >= ?").bind(monthAgo).first<{ cnt: number }>(),
  ]);

  return Response.json({
    service: 'news',
    name: 'News',
    icon: '📰',
    updatedAt: now.toISOString(),
    metrics: [
      { label: '팩트체크 수', value: factchecks?.cnt ?? 0, type: 'number' },
      { label: '분석된 기자', value: journalists?.cnt ?? 0, type: 'number' },
    ],
    growth: [
      { label: '7일 팩트체크', value: fcWeek?.cnt ?? 0 },
      { label: '30일 팩트체크', value: fcMonth?.cnt ?? 0 },
    ],
  }, { headers: { 'Access-Control-Allow-Origin': 'https://admin.cocy.io' } });
};

export const onRequestOptions = () =>
  new Response(null, { headers: { 'Access-Control-Allow-Origin': 'https://admin.cocy.io', 'Access-Control-Allow-Headers': 'X-Admin-Secret' } });
