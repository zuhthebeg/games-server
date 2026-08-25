// GET/POST /api/rankings/voicematch-daily — 목소리 노래방 "오늘의 도전" 데일리 리더보드
// 하루 1명(클라가 UTC 날짜 해시로 결정)의 도전 가수와 닮음%를 겨룬다. 보드는 UTC 날짜 단위.
// GET  ?day=YYYYMMDD&me=userId → 해당 날짜 TOP N + 참여자수 + 내 순위 (day 생략 시 오늘)
// POST {userId, artist, pct}   → 등록계정만, 오늘 보드에 유저당 최고 % 갱신 (day는 서버가 결정)
import type { D1Database } from '@cloudflare/workers-types';
import { ensureCountryColumn, extractCountry, updateUserCountry } from './_rank_utils';
interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

function todayUTC(): string {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function ensureTable(DB: D1Database) {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS voicematch_daily (
        day TEXT NOT NULL,
        user_id TEXT NOT NULL,
        artist TEXT NOT NULL,
        pct INTEGER NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (day, user_id)
    )`).run();
}

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    try {
        await ensureTable(DB);
        const dayRaw = url.searchParams.get('day') || todayUTC();
        const day = /^\d{8}$/.test(dayRaw) ? dayRaw : todayUTC();
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
        const result = await DB.prepare(`
            SELECT v.user_id,
                   COALESCE(u.nickname, '익명#' || substr(v.user_id,1,6)) AS nickname,
                   v.pct, v.updated_at, u.country AS country
            FROM voicematch_daily v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE v.day = ?
            ORDER BY v.pct DESC, v.updated_at ASC
            LIMIT ?
        `).bind(day, limit).all();
        const cnt = await DB.prepare('SELECT COUNT(*) AS c FROM voicematch_daily WHERE day = ?')
            .bind(day).first<{ c: number }>();
        let myRank: number | null = null, myPct: number | null = null;
        const me = url.searchParams.get('me');
        if (me) {
            const mine = await DB.prepare('SELECT pct FROM voicematch_daily WHERE day = ? AND user_id = ?')
                .bind(day, me).first<{ pct: number }>();
            if (mine) {
                myPct = mine.pct;
                const above = await DB.prepare(
                    'SELECT COUNT(*) AS c FROM voicematch_daily WHERE day = ? AND pct > ?')
                    .bind(day, mine.pct).first<{ c: number }>();
                myRank = (above?.c || 0) + 1;
            }
        }
        return Response.json({
            success: true, day, entries: cnt?.c || 0,
            rankings: result.results || [], myRank, myPct,
        }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; artist?: string; pct?: number } =
            await context.request.json();
        const userId = body.userId || context.request.headers.get('x-user-id');
        const artist = (body.artist || '').replace(/[^a-z0-9_]/g, '').slice(0, 30);
        const pct = Math.round(Number(body.pct));
        if (!userId || !artist || !(pct >= 1 && pct <= 99))
            return Response.json({ success: false, error: 'userId, artist, pct(1-99) required' }, { status: 400, headers: CORS });

        // 등록계정만 제출 가능 (익명/미등록 → need_login) — voicematch.ts와 동일한 정책
        const u = await DB.prepare('SELECT is_anonymous FROM users WHERE id = ?')
            .bind(userId).first<{ is_anonymous: number }>();
        if (!u || u.is_anonymous)
            return Response.json({ success: false, error: 'need_login' }, { status: 403, headers: CORS });

        await ensureCountryColumn(DB);
        await updateUserCountry(DB, userId, extractCountry(context.request));
        await ensureTable(DB);
        const day = todayUTC(); // 날짜는 서버가 정한다 — 지난 보드 조작 방지
        await DB.prepare(`
            INSERT INTO voicematch_daily (day, user_id, artist, pct, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(day, user_id) DO UPDATE SET
                pct = MAX(pct, excluded.pct),
                artist = excluded.artist,
                updated_at = CASE WHEN excluded.pct > pct THEN datetime('now') ELSE updated_at END
        `).bind(day, userId, artist, pct).run();

        const mine = await DB.prepare('SELECT pct FROM voicematch_daily WHERE day = ? AND user_id = ?')
            .bind(day, userId).first<{ pct: number }>();
        const above = await DB.prepare('SELECT COUNT(*) AS c FROM voicematch_daily WHERE day = ? AND pct > ?')
            .bind(day, mine?.pct || pct).first<{ c: number }>();
        return Response.json({ success: true, day, myRank: (above?.c || 0) + 1, myPct: mine?.pct || pct }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};
