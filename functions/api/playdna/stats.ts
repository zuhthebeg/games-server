// GET/POST /api/playdna/stats — 플레이DNA 유형 분포 카운터 (익명, 인증 불필요)
// GET  → {success, total, dist:{type:cnt,...}}
// POST {type} → 화이트리스트 8종 슬러그 검증, cnt+1, 응답 {success, total, mine, pct}
import type { D1Database } from '@cloudflare/workers-types';
interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

const VALID_TYPES = ['tiger', 'bulldog', 'hawk', 'bear', 'dolphin', 'squirrel', 'owl', 'turtle'];

async function ensureTable(DB: D1Database) {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS playdna_stats (
        type TEXT PRIMARY KEY,
        cnt INTEGER NOT NULL DEFAULT 0
    )`).run();
}

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        await ensureTable(DB);
        const result = await DB.prepare('SELECT type, cnt FROM playdna_stats').all();
        const dist: Record<string, number> = {};
        let total = 0;
        for (const row of (result.results || []) as { type: string; cnt: number }[]) {
            dist[row.type] = row.cnt;
            total += row.cnt;
        }
        return Response.json({ success: true, total, dist }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body: { type?: string } = await context.request.json();
        const type = (body.type || '').trim();
        if (!VALID_TYPES.includes(type))
            return Response.json({ success: false, error: 'invalid type' }, { status: 400, headers: CORS });

        await ensureTable(DB);
        await DB.prepare(`
            INSERT INTO playdna_stats (type, cnt) VALUES (?, 1)
            ON CONFLICT(type) DO UPDATE SET cnt = cnt + 1
        `).bind(type).run();

        const result = await DB.prepare('SELECT type, cnt FROM playdna_stats').all();
        const rows = (result.results || []) as { type: string; cnt: number }[];
        let total = 0, mine = 0;
        for (const row of rows) {
            total += row.cnt;
            if (row.type === type) mine = row.cnt;
        }
        const pct = total > 0 ? Math.round((mine / total) * 1000) / 10 : 0;

        return Response.json({ success: true, total, mine, pct }, { headers: CORS });
    } catch (e) {
        return Response.json({ success: false, error: String(e) }, { status: 500, headers: CORS });
    }
};
