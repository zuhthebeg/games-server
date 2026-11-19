// POST /api/voicematch/event — PII 없는 익명 집계 카운터 (VM-I10).
// 방문→녹음→분석→결과→공유→로그인탭 퍼널을 (day, ev, loc, ref) UPSERT로만 센다.
// 사용자 id·IP·UA 원문·임의 문자열은 저장하지 않는다. 봇 UA는 카운트하지 않는다.
// 응답은 언제나 204 — 카운터 실패가 게임 플로우에 신호를 주면 안 된다.
import { BOT_UA } from '../auth/anonymous';

const EV_SET = new Set(['visit', 'rec_start', 'analyze_done', 'result_view', 'share', 'login_tap']);
const LOC_SET = new Set(['ko', 'en', 'ja', 'es', 'pt', 'tw', 'id']);
const REF_SET = new Set(['threads', 'instagram', 'facebook', 'x', 'google', 'direct', 'other']);
const MAX_BODY = 1024; // 1KB — 정상 페이로드는 수십 바이트

// Origin이 있으면 game.cocy.io 계열만 허용한다. 반환값: 허용 오리진 / null(Origin 없음) / ''(거부)
function allowedOrigin(req: Request): string | null {
    const o = req.headers.get('Origin');
    if (!o) return null;
    try {
        const h = new URL(o).hostname;
        return h === 'game.cocy.io' || h.endsWith('.game.cocy.io') ? o : '';
    } catch { return ''; }
}

const cors = (origin: string | null) => ({
    'Access-Control-Allow-Origin': origin || 'https://game.cocy.io',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
});

const empty = (h: Record<string, string>) => new Response(null, { status: 204, headers: h });

async function ensureTable(db: D1Database) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS voicematch_events (
        day TEXT NOT NULL,
        ev TEXT NOT NULL,
        loc TEXT NOT NULL,
        ref TEXT NOT NULL,
        n INTEGER NOT NULL,
        PRIMARY KEY (day, ev, loc, ref)
    )`).run();
}

export const onRequestOptions: PagesFunction = async (ctx) =>
    empty(cors(allowedOrigin(ctx.request)));

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
    const origin = allowedOrigin(ctx.request);
    const CORS = cors(origin);
    try {
        // 다른 오리진의 브라우저 비콘은 세지 않는다 (Origin 없는 비브라우저 호출은 통과)
        if (origin === '') return empty(CORS);
        if (BOT_UA.test(ctx.request.headers.get('User-Agent') || '')) return empty(CORS);
        const cl = parseInt(ctx.request.headers.get('Content-Length') || '0', 10);
        if (cl > MAX_BODY) return empty(CORS);
        const text = await ctx.request.text();
        if (!text || text.length > MAX_BODY) return empty(CORS);
        const body = JSON.parse(text) as { ev?: unknown; loc?: unknown; ref?: unknown };
        const ev = typeof body?.ev === 'string' && EV_SET.has(body.ev) ? body.ev : null;
        if (!ev) return empty(CORS);
        // 클라 문자열을 그대로 저장하지 않는다 — 화이트리스트 enum으로만 정규화
        const loc = typeof body.loc === 'string' && LOC_SET.has(body.loc) ? body.loc : 'other';
        const ref = typeof body.ref === 'string' && REF_SET.has(body.ref) ? body.ref : 'other';
        const day = new Date().toISOString().slice(0, 10);
        await ensureTable(ctx.env.DB);
        await ctx.env.DB.prepare(
            `INSERT INTO voicematch_events (day, ev, loc, ref, n) VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(day, ev, loc, ref) DO UPDATE SET n = n + 1`
        ).bind(day, ev, loc, ref).run();
    } catch { /* 조용히 무시 */ }
    return empty(CORS);
};
