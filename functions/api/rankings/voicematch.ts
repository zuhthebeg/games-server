// GET/POST /api/rankings/voicematch — 목소리 노래방 가수별 닮은꼴 리더보드
// GET  ?artist=slug&limit=10&me=userId  → 해당 가수 TOP N + 내 순위
// GET  ?summary=1                        → 가수별 1위/참가자수 요약
// POST {userId, nickname, artist, pct}  → 등록계정만, 유저당 가수별 최고 % 갱신
import type { D1Database } from '@cloudflare/workers-types';
interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

async function ensureTable(DB: D1Database) {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS voicematch_rankings (
        user_id TEXT NOT NULL,
        artist TEXT NOT NULL,
        pct INTEGER NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (user_id, artist)
    )`).run();
}

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    try {
        await ensureTable(DB);
        if (url.searchParams.get('summary')) {
            const result = await DB.prepare(`
                SELECT v.artist,
                       COUNT(*) AS entries,
                       MAX(v.pct) AS top_pct
                FROM voicematch_rankings v
                GROUP BY v.artist
                ORDER BY entries DESC
                LIMIT 120
            `).all();
            return Response.json({ success: true, summary: result.results || [] }, { headers: CORS });
        }
        const artist = (url.searchParams.get('artist') || '').replace(/[^a-z0-9_]/g, '').slice(0, 30);
        if (!artist)
            return Response.json({ success: false, error: 'artist required' }, { status: 400, headers: CORS });
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
        const result = await DB.prepare(`
            SELECT v.user_id,
                   COALESCE(u.nickname, '익명#' || substr(v.user_id,1,6)) AS nickname,
                   v.pct, v.updated_at
            FROM voicematch_rankings v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE v.artist = ?
            ORDER BY v.pct DESC, v.updated_at ASC
            LIMIT ?
        `).bind(artist, limit).all();
        let myRank: number | null = null, myPct: number | null = null;
        const me = url.searchParams.get('me');
        if (me) {
            const mine = await DB.prepare('SELECT pct FROM voicematch_rankings WHERE artist = ? AND user_id = ?')
                .bind(artist, me).first<{ pct: number }>();
            if (mine) {
                myPct = mine.pct;
                const above = await DB.prepare(
                    'SELECT COUNT(*) AS c FROM voicematch_rankings WHERE artist = ? AND pct > ?')
                    .bind(artist, mine.pct).first<{ c: number }>();
                myRank = (above?.c || 0) + 1;
            }
        }
        return Response.json({ success: true, rankings: result.results || [], myRank, myPct }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; nickname?: string; artist?: string; pct?: number } =
            await context.request.json();
        const userId = body.userId || context.request.headers.get('x-user-id');
        const artist = (body.artist || '').replace(/[^a-z0-9_]/g, '').slice(0, 30);
        const pct = Math.round(Number(body.pct));
        if (!userId || !artist || !(pct >= 1 && pct <= 99))
            return Response.json({ success: false, error: 'userId, artist, pct(1-99) required' }, { status: 400, headers: CORS });

        // 등록계정만 제출 가능 (익명/미등록 → need_login)
        const u = await DB.prepare('SELECT is_anonymous FROM users WHERE id = ?')
            .bind(userId).first<{ is_anonymous: number }>();
        if (!u || u.is_anonymous)
            return Response.json({ success: false, error: 'need_login' }, { status: 403, headers: CORS });

        await ensureTable(DB);
        await DB.prepare(`
            INSERT INTO voicematch_rankings (user_id, artist, pct, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, artist) DO UPDATE SET
                pct = MAX(pct, excluded.pct),
                updated_at = CASE WHEN excluded.pct > pct THEN datetime('now') ELSE updated_at END
        `).bind(userId, artist, pct).run();

        const mine = await DB.prepare('SELECT pct FROM voicematch_rankings WHERE artist = ? AND user_id = ?')
            .bind(artist, userId).first<{ pct: number }>();
        const above = await DB.prepare('SELECT COUNT(*) AS c FROM voicematch_rankings WHERE artist = ? AND pct > ?')
            .bind(artist, mine?.pct || pct).first<{ c: number }>();
        return Response.json({ success: true, myRank: (above?.c || 0) + 1, myPct: mine?.pct || pct }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};
