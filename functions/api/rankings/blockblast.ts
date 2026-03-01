// GET/POST /api/rankings/blockblast — 최고 점수 랭킹
import type { D1Database } from '@cloudflare/workers-types';

interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

async function ensureColumns(DB: D1Database) {
    const cols = ['blockblast_best_score INTEGER DEFAULT 0', 'blockblast_updated_at TEXT'];
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

// GET — 랭킹 조회
export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);

    try {
        await ensureColumns(DB);
        const result = await DB.prepare(`
            SELECT
                r.user_id,
                COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 6)) AS nickname,
                COALESCE(r.blockblast_best_score, 0) AS best_score,
                r.blockblast_updated_at AS updated_at
            FROM rankings r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE COALESCE(r.blockblast_best_score, 0) > 0
            ORDER BY r.blockblast_best_score DESC, r.blockblast_updated_at ASC
            LIMIT ?
        `).bind(limit).all();

        return Response.json({ success: true, rankings: result.results || [] }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};

// POST — 기록 갱신
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; nickname?: string; score: number } =
            await context.request.json();

        const userId = body.userId || context.request.headers.get('x-user-id');
        if (!userId || !body.score || body.score <= 0) {
            return Response.json({ success: false, error: 'userId and score required' }, { status: 400, headers: CORS });
        }

        await ensureColumns(DB);
        await ensureUser(DB, userId, body.nickname);

        await DB.prepare('INSERT OR IGNORE INTO rankings (user_id) VALUES (?)').bind(userId).run();
        const updated = await DB.prepare(`
            UPDATE rankings
            SET blockblast_best_score = ?, blockblast_updated_at = datetime('now')
            WHERE user_id = ? AND (COALESCE(blockblast_best_score, 0) < ?)
        `).bind(body.score, userId, body.score).run();

        const row = await DB.prepare(
            'SELECT blockblast_best_score FROM rankings WHERE user_id = ?'
        ).bind(userId).first<{ blockblast_best_score: number }>();

        return Response.json({
            success: true,
            updated: (updated.meta?.changes || 0) > 0,
            bestScore: row?.blockblast_best_score || body.score,
        }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};
