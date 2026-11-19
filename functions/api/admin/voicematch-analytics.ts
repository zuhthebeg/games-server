// GET /api/admin/voicematch-analytics?days=14 — 보이스매치 유입→제출→재방문·DB 상태 집계 (읽기 전용)
// 집계 로직은 ./_vm_analytics.ts 순수 함수로 분리 (node --test 대상)
import { addDays, assembleAnalytics, lastNDays } from './_vm_analytics';
import type { ArtistCntRow, CountryRow, DailyRow, EntryRow, EventRow, ReqLatestRow, ReqStatusRow } from './_vm_analytics';

const ADMIN_SECRET = 'cocy-admin-2026-r1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Admin-Secret, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// 일별 voicematch_daily.day는 'YYYYMMDD' — 날짜 혼재 포맷을 YYYY-MM-DD로 정규화
const DAILY_ROWS_SQL = `
  SELECT * FROM (
    SELECT CASE WHEN length(day) = 8 AND day NOT LIKE '%-%'
           THEN substr(day,1,4) || '-' || substr(day,5,2) || '-' || substr(day,7,2)
           ELSE day END AS d,
           user_id, artist, pct, updated_at
    FROM voicematch_daily
  ) WHERE d >= ? AND d <= ?`;

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  if (ctx.request.headers.get('X-Admin-Secret') !== ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  }

  const db = ctx.env.DB;
  const raw = parseInt(new URL(ctx.request.url).searchParams.get('days') || '14', 10);
  const days = Math.min(60, Math.max(1, Number.isFinite(raw) ? raw : 14));
  const today = new Date().toISOString().slice(0, 10);
  const dayRange = lastNDays(today, days);
  const rangeStart = dayRange[0];
  // 리텐션의 직전 7일 창이 조회 범위(days<14)를 벗어날 수 있어 넉넉히 가져온다
  const fetchStart = addDays(today, -Math.max(days - 1, 13));

  const [entryRows, countryRows, dailyRows, rankingTop, ranked, registeredRanked, vmSignups, reqStatus, reqLatest, eventRows] = await Promise.all([
    db.prepare(
      `SELECT substr(created_at,1,10) AS d, bot_status AS bs, COUNT(*) AS cnt
       FROM users WHERE signup_game = 'voicematch' AND substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?
       GROUP BY d, bs`
    ).bind(rangeStart, today).all<EntryRow>().catch(() => ({ results: [] as EntryRow[] })),
    db.prepare(
      `SELECT country, COUNT(*) AS cnt FROM users
       WHERE signup_game = 'voicematch' AND bot_status IN ('human','suspect')
         AND country IS NOT NULL AND country != ''
         AND substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?
       GROUP BY country ORDER BY cnt DESC LIMIT 10`
    ).bind(rangeStart, today).all<CountryRow>().catch(() => ({ results: [] as CountryRow[] })),
    db.prepare(DAILY_ROWS_SQL).bind(fetchStart, today).all<DailyRow>().catch(() => ({ results: [] as DailyRow[] })),
    db.prepare(
      'SELECT artist, COUNT(*) AS cnt FROM voicematch_rankings GROUP BY artist ORDER BY cnt DESC, artist ASC LIMIT 10'
    ).all<ArtistCntRow>().catch(() => ({ results: [] as ArtistCntRow[] })),
    db.prepare('SELECT COUNT(DISTINCT user_id) AS cnt FROM voicematch_rankings').first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    db.prepare(
      `SELECT COUNT(DISTINCT v.user_id) AS cnt FROM voicematch_rankings v
       JOIN users u ON u.id = v.user_id WHERE u.is_anonymous = 0`
    ).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    db.prepare(
      "SELECT COUNT(*) AS cnt FROM users WHERE signup_game = 'voicematch' AND is_anonymous = 0"
    ).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    db.prepare('SELECT status, COUNT(*) AS cnt FROM voicematch_requests GROUP BY status').all<ReqStatusRow>().catch(() => ({ results: [] as ReqStatusRow[] })),
    db.prepare(
      'SELECT artist, status, created_at AS created FROM voicematch_requests ORDER BY id DESC LIMIT 5'
    ).all<ReqLatestRow>().catch(() => ({ results: [] as ReqLatestRow[] })),
    // VM-I10 익명 이벤트 카운터 — 테이블이 아직 없으면 빈 배열로 조용히 넘긴다
    db.prepare(
      'SELECT day AS d, ev, loc, ref, n FROM voicematch_events WHERE day >= ? AND day <= ?'
    ).bind(rangeStart, today).all<EventRow>().catch(() => ({ results: [] as EventRow[] })),
  ]);

  const body = assembleAnalytics({
    generatedAt: new Date().toISOString(),
    today,
    dayRange,
    entryRows: entryRows.results || [],
    countryRows: countryRows.results || [],
    dailyRows: dailyRows.results || [],
    rankingTop: rankingTop.results || [],
    rankedUsers: ranked?.cnt ?? 0,
    registeredRanked: registeredRanked?.cnt ?? 0,
    voicematchSignups: vmSignups?.cnt ?? 0,
    requestStatus: reqStatus.results || [],
    requestLatest: reqLatest.results || [],
    eventRows: eventRows.results || [],
  });

  return Response.json(body, { headers: CORS });
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
