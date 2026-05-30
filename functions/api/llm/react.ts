// POST /api/llm/react — 마작 상대(CPU)의 짧은 리액션 한마디 (llm.cocy.io 경유)
interface Env { LLM_SECRET?: string }

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
    try {
        const body = await ctx.request.json().catch(() => ({})) as { situation?: string; lang?: string; name?: string };
        const sit = String(body.situation || 'win').slice(0, 60);
        const langName = body.lang === 'zh-TW' ? '台灣繁體中文' : '한국어';
        const name = String(body.name || 'CPU').slice(0, 16);
        const prompt = `너는 대만마작 온라인게임의 상대 플레이어 "${name}". 방금 상황: "${sit}". 이 상황에 어울리는 짧고 재치있는 한마디를 ${langName}로 한 문장(12자 이내)만 해라. 도발·감탄·아쉬움·너스레 등 자유롭게. 따옴표나 이모지 없이 대사만.`;
        const secret = ctx.env.LLM_SECRET || 'choon150622';
        let text = '';
        try {
            const r = await fetch('https://llm.cocy.io/v2/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
                body: JSON.stringify({ model: 'haiku', messages: [{ role: 'user', content: prompt }], temperature: 1.4, max_tokens: 40 }),
            });
            if (r.ok) { const d = await r.json() as any; text = d?.choices?.[0]?.message?.content || ''; }
        } catch { }
        text = (text || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\n.*/s, '').slice(0, 40);
        return Response.json({ text }, { headers: CORS });
    } catch (e) {
        return Response.json({ text: '' }, { headers: CORS });
    }
};
