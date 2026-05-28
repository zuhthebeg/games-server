// GET/POST /api/rankings/pingtan — 최속 승리 시간 랭킹 (낮을수록 좋음)
import type { D1Database } from '@cloudflare/workers-types';
interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

async function ensureColumns(DB: D1Database) {
    // best_time_sec: 낮을수록 좋음 (NULL = 미등록, 초기값 큰 수)
    const cols = ['pingtan_best_time_sec INTEGER DEFAULT 99999', 'pingtan_updated_at TEXT'];
    for (const col of cols) {
        try { await DB.prepare(`ALTER TABLE rankings ADD COLUMN ${col}`).run(); } catch { }
    }
}

async function ensureUser(DB: D1Database, userId: string, nickname?: string) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)')
        .bind(userId, nickname || null).run();
    if (nickname) {
        await DB.prepare('UPDATE users SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname != ?)')
            .bind(nickname, userId, nickname).run();
    }
}

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    try {
        await ensureColumns(DB);
        const result = await DB.prepare(`
            SELECT
                r.user_id,
                COALESCE(u.nickname, '익명#' || substr(r.user_id,1,6)) AS nickname,
                r.pingtan_best_time_sec AS best_time_sec,
                r.pingtan_updated_at AS updated_at
            FROM rankings r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.pingtan_best_time_sec IS NOT NULL AND r.pingtan_best_time_sec < 99999
            ORDER BY r.pingtan_best_time_sec ASC, r.pingtan_updated_at ASC
            LIMIT ?
        `).bind(limit).all();
        return Response.json({ success: true, rankings: result.results || [] }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; nickname?: string; timeSec: number } =
            await context.request.json();
        const userId = body.userId || context.request.headers.get('x-user-id');
        if (!userId || !body.timeSec || body.timeSec <= 0)
            return Response.json({ success: false, error: 'userId and timeSec required' }, { status: 400, headers: CORS });
        await ensureColumns(DB);
        await ensureUser(DB, userId, body.nickname);
        await DB.prepare('INSERT OR IGNORE INTO rankings (user_id) VALUES (?)').bind(userId).run();
        // 낮을수록 좋으므로 MIN 사용
        await DB.prepare(`
            UPDATE rankings
            SET pingtan_best_time_sec = MIN(COALESCE(pingtan_best_time_sec, 99999), ?),
                pingtan_updated_at = datetime('now')
            WHERE user_id = ?
        `).bind(body.timeSec, userId).run();
        return Response.json({ success: true }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};
