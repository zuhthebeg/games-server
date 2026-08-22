// GET/POST /api/rankings/footprints — 발자국(page.cocy.io/footprints) 칭호 랭킹
// 원본 좌표/경로는 전송하지 않음 — 클라이언트가 온디바이스로 계산한 칭호(title)+티어(숫자)만 저장
import type { D1Database } from '@cloudflare/workers-types';
import { ensureCountryColumn, extractCountry, updateUserCountry } from './_rank_utils';

interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

async function ensureColumns(DB: D1Database) {
    const cols = [
        'footprints_tier INTEGER DEFAULT 0',
        'footprints_title TEXT',
        'footprints_updated_at TEXT',
    ];
    for (const col of cols) {
        try { await DB.prepare(`ALTER TABLE rankings ADD COLUMN ${col}`).run(); } catch { }
    }
    await ensureCountryColumn(DB);
}

async function ensureUser(DB: D1Database, userId: string, nickname?: string, country?: string | null) {
    await DB.prepare('INSERT OR IGNORE INTO users (id, nickname, is_anonymous) VALUES (?, ?, 1)')
        .bind(userId, nickname || null).run();
    if (nickname) {
        await DB.prepare('UPDATE users SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname != ?)')
            .bind(nickname, userId, nickname).run();
    }
    await updateUserCountry(DB, userId, country ?? null);
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
                u.country AS country,
                COALESCE(u.nickname, '익명#' || substr(r.user_id, 1, 6)) AS nickname,
                COALESCE(r.footprints_tier, 0) AS tier,
                r.footprints_title AS title,
                r.footprints_updated_at AS updated_at
            FROM rankings r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE COALESCE(r.footprints_tier, 0) > 0
            ORDER BY r.footprints_tier DESC, r.footprints_updated_at ASC
            LIMIT ?
        `).bind(limit).all();

        return Response.json({ success: true, rankings: result.results || [] }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};

// POST — 칭호 등록/갱신 (opt-in, 더 높은 티어일 때만 갱신)
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { userId?: string; nickname?: string; tier: number; title: string } =
            await context.request.json();

        const userId = body.userId || context.request.headers.get('x-user-id');
        const tier = Number(body.tier);
        const title = String(body.title || '').slice(0, 40);
        if (!userId || !tier || tier <= 0 || !title) {
            return Response.json({ success: false, error: 'userId, tier, title required' }, { status: 400, headers: CORS });
        }

        await ensureColumns(DB);
        const country = extractCountry(context.request);
        await ensureUser(DB, userId, body.nickname, country);

        await DB.prepare('INSERT OR IGNORE INTO rankings (user_id) VALUES (?)').bind(userId).run();
        const updated = await DB.prepare(`
            UPDATE rankings
            SET footprints_tier = ?, footprints_title = ?, footprints_updated_at = datetime('now')
            WHERE user_id = ? AND (COALESCE(footprints_tier, 0) < ?)
        `).bind(tier, title, userId, tier).run();

        const row = await DB.prepare(
            'SELECT footprints_tier, footprints_title FROM rankings WHERE user_id = ?'
        ).bind(userId).first<{ footprints_tier: number; footprints_title: string }>();

        return Response.json({
            success: true,
            updated: (updated.meta?.changes || 0) > 0,
            bestTier: row?.footprints_tier || tier,
            bestTitle: row?.footprints_title || title,
        }, { headers: CORS });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: CORS });
    }
};
