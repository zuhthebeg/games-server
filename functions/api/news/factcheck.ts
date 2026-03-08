interface Env { DB: D1Database; }

type FactcheckPayload = {
  article_url: string;
  article_title?: string | null;
  summary?: string | null;
  result_type: 'factcheck' | 'review';
  score?: number | null;
  reason?: string | null;
  caution?: string | null;
  evaluation?: string | null;
  bias?: string | null;
  headline_intent?: string | null;
  headline_fair?: boolean | number | null;
  headline_note?: string | null;
  journalist_name?: string | null;
  journalist_media?: string | null;
};

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: JSON_HEADERS });

function normText(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toHeadlineFair(v: FactcheckPayload['headline_fair']): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return Number(v) ? 1 : 0;
}

async function updateJournalistAgg(env: Env, payload: FactcheckPayload) {
  const name = normText(payload.journalist_name);
  if (!name) return;
  const media = normText(payload.journalist_media);

  const agg = await env.DB.prepare(
    `SELECT
      COUNT(*) AS article_count,
      AVG(CASE WHEN result_type = 'factcheck' THEN score END) AS avg_score
     FROM news_factcheck
     WHERE journalist_name = ?
       AND COALESCE(journalist_media, '') = COALESCE(?, '')`
  ).bind(name, media).first();

  const intents = await env.DB.prepare(
    `SELECT headline_intent, COUNT(*) AS cnt
     FROM news_factcheck
     WHERE journalist_name = ?
       AND COALESCE(journalist_media, '') = COALESCE(?, '')
       AND headline_intent IS NOT NULL
       AND headline_intent != ''
     GROUP BY headline_intent`
  ).bind(name, media).all();

  const intentCounts: Record<string, number> = {};
  for (const row of intents.results || []) {
    if (row.headline_intent) intentCounts[row.headline_intent] = Number(row.cnt || 0);
  }

  const biasSummary = normText(payload.bias);
  const qualitySummary = normText(payload.evaluation || payload.reason || payload.caution);

  await env.DB.prepare(
    `INSERT INTO news_journalists (
      name, media, article_count, avg_score, bias_summary, quality_summary,
      intent_counts, last_article_url, last_checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(name, media) DO UPDATE SET
      article_count = excluded.article_count,
      avg_score = excluded.avg_score,
      bias_summary = COALESCE(excluded.bias_summary, news_journalists.bias_summary),
      quality_summary = COALESCE(excluded.quality_summary, news_journalists.quality_summary),
      intent_counts = excluded.intent_counts,
      last_article_url = excluded.last_article_url,
      last_checked_at = datetime('now')`
  ).bind(
    name,
    media,
    Number(agg?.article_count || 0),
    agg?.avg_score ?? null,
    biasSummary,
    qualitySummary,
    JSON.stringify(intentCounts),
    payload.article_url
  ).run();
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const articleUrl = url.searchParams.get('url');

    if (!articleUrl) {
      return new Response(JSON.stringify({ error: 'url is required' }), { status: 400, headers: JSON_HEADERS });
    }

    const row = await env.DB.prepare(
      `SELECT id, article_url, article_title, summary, result_type, score, reason, caution, evaluation, bias,
              headline_intent, headline_fair, headline_note, journalist_name, journalist_media, created_at, updated_at
       FROM news_factcheck
       WHERE article_url = ?`
    ).bind(articleUrl).first();

    if (!row) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ cached: true, data: row }), { status: 200, headers: JSON_HEADERS });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'server error' }), { status: 500, headers: JSON_HEADERS });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as Partial<FactcheckPayload>;

    const payload: FactcheckPayload = {
      article_url: normText(body.article_url) || '',
      article_title: normText(body.article_title),
      summary: normText(body.summary),
      result_type: body.result_type === 'review' ? 'review' : 'factcheck',
      score: body.score === null || body.score === undefined ? null : Number(body.score),
      reason: normText(body.reason),
      caution: normText(body.caution),
      evaluation: normText(body.evaluation),
      bias: normText(body.bias),
      headline_intent: normText(body.headline_intent),
      headline_fair: body.headline_fair ?? null,
      headline_note: normText(body.headline_note),
      journalist_name: normText(body.journalist_name),
      journalist_media: normText(body.journalist_media),
    };

    if (!payload.article_url) {
      return new Response(JSON.stringify({ error: 'article_url is required' }), { status: 400, headers: JSON_HEADERS });
    }

    await env.DB.prepare(
      `INSERT INTO news_factcheck (
        article_url, article_title, summary, result_type, score, reason, caution, evaluation, bias,
        headline_intent, headline_fair, headline_note, journalist_name, journalist_media, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(article_url) DO UPDATE SET
        article_title = excluded.article_title,
        summary = excluded.summary,
        result_type = excluded.result_type,
        score = excluded.score,
        reason = excluded.reason,
        caution = excluded.caution,
        evaluation = excluded.evaluation,
        bias = excluded.bias,
        headline_intent = excluded.headline_intent,
        headline_fair = excluded.headline_fair,
        headline_note = excluded.headline_note,
        journalist_name = excluded.journalist_name,
        journalist_media = excluded.journalist_media,
        updated_at = datetime('now')`
    ).bind(
      payload.article_url,
      payload.article_title,
      payload.summary,
      payload.result_type,
      payload.score,
      payload.reason,
      payload.caution,
      payload.evaluation,
      payload.bias,
      payload.headline_intent,
      toHeadlineFair(payload.headline_fair),
      payload.headline_note,
      payload.journalist_name,
      payload.journalist_media
    ).run();

    const row = await env.DB.prepare('SELECT id FROM news_factcheck WHERE article_url = ?').bind(payload.article_url).first();

    await updateJournalistAgg(env, payload);

    return new Response(JSON.stringify({ ok: true, id: row?.id || null }), { status: 200, headers: JSON_HEADERS });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'server error' }), { status: 500, headers: JSON_HEADERS });
  }
};
