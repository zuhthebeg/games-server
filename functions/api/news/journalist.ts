interface Env { DB: D1Database; }

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: JSON_HEADERS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || '').trim();
    const media = (url.searchParams.get('media') || '').trim();

    if (!name) {
      return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: JSON_HEADERS });
    }

    const row = await env.DB.prepare(
      `SELECT id, name, media, article_count, avg_score, bias_summary, quality_summary,
              intent_counts, last_article_url, last_checked_at
       FROM news_journalists
       WHERE name = ? AND COALESCE(media, '') = COALESCE(?, '')`
    ).bind(name, media || null).first();

    if (!row) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ ok: true, data: row }), { status: 200, headers: JSON_HEADERS });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'server error' }), { status: 500, headers: JSON_HEADERS });
  }
};
