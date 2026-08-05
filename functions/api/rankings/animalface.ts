// GET/POST /api/rankings/animalface — 동물상 분포(희귀도) 집계
//
// 다른 게임처럼 '최고 점수' 랭킹을 두지 않는다. 판독 결과의 일치율은 1위 기준 상대 스케일이라
// 거의 모두 90%대로 나온다 → 순위가 갈리지 않고 사진만 바꿔 올리면 되는 무의미한 판이 된다.
// 대신 여기서는 "무슨 동물상이 얼마나 나왔나"를 모아 희귀도를 보여준다. 이게 이 게임의 점수다.
import type { D1Database } from '@cloudflare/workers-types';

interface Env { DB: D1Database; }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

// animals.json의 id만 받는다. 임의 문자열이 들어오면 분포가 오염된다.
const ANIMALS = new Set([
    'dog', 'cat', 'rabbit', 'fox', 'fox_pretty', 'fox_ugly', 'gumiho', 'deer', 'hamster',
    'squirrel', 'bear', 'wolf', 'dino', 'fennec', 'duck', 'chick', 'tiger', 'raccoon',
    'shihtzu', 'pig', 'frog', 'snake', 'bulldog', 'molerat', 'starnose', 'blobfish',
]);
const SEXES = new Set(['f', 'm', '']);

async function ensureTable(DB: D1Database) {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS animalface_stats (
        animal TEXT NOT NULL,
        sex    TEXT NOT NULL DEFAULT '',
        count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (animal, sex)
    )`).run();
}

export const onRequestOptions: PagesFunction = async () =>
    new Response(null, { status: 204, headers: CORS });

// GET /api/rankings/animalface?sex=f — 분포. sex를 주면 그 성별 안에서의 분포.
export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    const url = new URL(context.request.url);
    const sex = url.searchParams.get('sex') || '';
    try {
        await ensureTable(DB);
        const q = SEXES.has(sex) && sex
            ? DB.prepare('SELECT animal, SUM(count) AS count FROM animalface_stats WHERE sex = ? GROUP BY animal ORDER BY count DESC').bind(sex)
            : DB.prepare('SELECT animal, SUM(count) AS count FROM animalface_stats GROUP BY animal ORDER BY count DESC');
        const rows = ((await q.all()).results || []) as { animal: string; count: number }[];
        const total = rows.reduce((s, r) => s + (r.count || 0), 0);
        return Response.json({ success: true, total, sex, rankings: rows }, { headers: CORS });
    } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: CORS });
    }
};

// POST {animal, sex} — 판독 1건 집계. 점수가 아니라 카운트라 userId를 요구하지 않는다.
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { DB } = context.env;
    try {
        const body = await context.request.json() as { animal?: string; sex?: string };
        const animal = body.animal || '';
        const sex = body.sex || '';
        if (!ANIMALS.has(animal) || !SEXES.has(sex)) {
            return Response.json({ success: false, error: 'invalid animal/sex' }, { status: 400, headers: CORS });
        }
        await ensureTable(DB);
        await DB.prepare(`INSERT INTO animalface_stats (animal, sex, count) VALUES (?, ?, 1)
            ON CONFLICT(animal, sex) DO UPDATE SET count = count + 1`).bind(animal, sex).run();
        const row = await DB.prepare('SELECT SUM(count) AS c FROM animalface_stats').first<{ c: number }>();
        const mine = await DB.prepare('SELECT SUM(count) AS c FROM animalface_stats WHERE animal = ?')
            .bind(animal).first<{ c: number }>();
        const total = row?.c || 0, cnt = mine?.c || 0;
        return Response.json({
            success: true, total, count: cnt,
            share: total ? +(cnt * 100 / total).toFixed(1) : 0,
        }, { headers: CORS });
    } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: CORS });
    }
};
