// GET/POST /api/rankings/tileslider — 단계별(3x3~9x9) 랭킹. 이동수 오름차순, 동률이면 시간 오름차순.
import type { D1Database } from '@cloudflare/workers-types';

interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

// 단계별 기록이라 rankings 컬럼 방식(7단계×3필드) 대신 전용 테이블을 쓴다
async function ensureTable(DB: D1Database) {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS tileslider_scores (
        user_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        moves INTEGER NOT NULL,
        seconds INTEGER NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (user_id, level)
    )`).run();
}

async function ensureUser(DB: D1Database, userId: string, nickname?: string) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)')
        .bind(userId, nickname || null).run();
    if (nickname) {
        await DB.prepare('UPDATE users SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname != ?)')
            .bind(nickname, userId, nickname).run();
    }
}

const validLevel = (l: number) => Number.isInteger(l) && l >= 3 && l <= 9;

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

// GET ?level=3&limit=10[&userId=...] — 해당 단계 랭킹 (+내 순위)
export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const level = parseInt(url.searchParams.get('level') || '3');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
    const userId = url.searchParams.get('userId');
    if (!validLevel(level)) return Response.json({ success: false, error: 'level 3-9' }, { status: 400, headers: CORS });

    try {
        await ensureTable(DB);
        const result = await DB.prepare(`
            SELECT s.user_id,
                   COALESCE(u.nickname, '익명#' || substr(s.user_id, 1, 6)) AS nickname,
                   s.moves, s.seconds, s.updated_at
            FROM tileslider_scores s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.level = ?
            ORDER BY s.moves ASC, s.seconds ASC
            LIMIT ?
        `).bind(level, limit).all();

        let me = null;
        if (userId) {
            const mine = await DB.prepare('SELECT moves, seconds FROM tileslider_scores WHERE user_id = ? AND level = ?')
                .bind(userId, level).first<{ moves: number; seconds: number }>();
            if (mine) {
                const better = await DB.prepare(
                    'SELECT COUNT(*) AS n FROM tileslider_scores WHERE level = ? AND (moves < ? OR (moves = ? AND seconds < ?))'
                ).bind(level, mine.moves, mine.moves, mine.seconds).first<{ n: number }>();
                me = { rank: (better?.n || 0) + 1, moves: mine.moves, seconds: mine.seconds };
            }
        }
        return Response.json({ success: true, level, rankings: result.results || [], me }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};

// POST {userId, nickname?, level, moves, seconds} — 더 좋은 기록일 때만 갱신
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; nickname?: string; level?: number; moves?: number; seconds?: number } =
            await context.request.json();
        const userId = body.userId || context.request.headers.get('x-user-id');
        const level = Number(body.level), moves = Number(body.moves), seconds = Number(body.seconds);
        if (!userId || !validLevel(level) || !(moves > 0) || !(seconds >= 0)) {
            return Response.json({ success: false, error: 'userId, level(3-9), moves, seconds required' }, { status: 400, headers: CORS });
        }

        await ensureTable(DB);
        await ensureUser(DB, userId, body.nickname);

        await DB.prepare(`
            INSERT INTO tileslider_scores (user_id, level, moves, seconds, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, level) DO UPDATE SET
                moves = excluded.moves, seconds = excluded.seconds, updated_at = excluded.updated_at
            WHERE excluded.moves < moves OR (excluded.moves = moves AND excluded.seconds < seconds)
        `).bind(userId, level, Math.floor(moves), Math.floor(seconds)).run();

        const row = await DB.prepare('SELECT moves, seconds FROM tileslider_scores WHERE user_id = ? AND level = ?')
            .bind(userId, level).first<{ moves: number; seconds: number }>();
        return Response.json({ success: true, best: row }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};
