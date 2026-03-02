// POST /api/hair/analyze — Vision AI + R2 + D1
interface Env { DB: D1Database; HAIR_BUCKET: R2Bucket; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const VISION_PROMPT = `You are a professional hair stylist. Analyze the hairstyle in this photo.
Return ONLY a JSON object:
{
  "style_name_ko": "한국어 스타일명",
  "style_name_en": "English name",
  "length": "short|medium|long",
  "texture": "straight|wavy|curly|coily",
  "color": "자연흑|브라운|금발|하이라이트|etc",
  "face_types": ["어울리는 얼굴형"],
  "difficulty": 3,
  "care_tips": {
    "daily": "매일 관리법",
    "weekly": "주간 관리법",
    "products": ["추천 제품"],
    "drying": "드라이 방법",
    "styling": "스타일링 팁"
  },
  "cost_cut_min": 15000, "cost_cut_max": 30000,
  "cost_perm_min": 50000, "cost_perm_max": 120000,
  "cost_color_min": 40000, "cost_color_max": 100000,
  "monthly_care": 30000,
  "salon_keywords": "미용실에서 이렇게 말하세요: ...",
  "gguan_ggyu_score": 75,
  "gguan_ggyu_reason": "꾸안꾸 판정 이유 2-3문장"
}
Rules:
- difficulty: 1(easy)~5(hard)
- gguan_ggyu_score: 0~100. 100=effortless natural look, 0=obviously high-maintenance
- Costs in KRW, Seoul 2026 average
- Be specific about products
- Return ONLY JSON, no markdown fences`;

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as any;
    if (!body.image || !body.imageOriginal)
      return new Response(JSON.stringify({ error: 'image and imageOriginal required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // 1. Vision AI
    const llmRes = await fetch('https://llm.cocy.io/v2/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer choon150622' },
      body: JSON.stringify({
        model: 'sonnet',
        messages: [{ role: 'user', content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: body.imageOriginal.startsWith('data:') ? body.imageOriginal : 'data:image/jpeg;base64,' + body.imageOriginal } }
        ]}],
        max_tokens: 2000, temperature: 0.3
      })
    });
    if (!llmRes.ok) return new Response(JSON.stringify({ error: 'AI failed', detail: await llmRes.text() }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const llmData = await llmRes.json() as any;
    const content = llmData.choices?.[0]?.message?.content || '';
    let analysis: any;
    try { analysis = JSON.parse(content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()); }
    catch { return new Response(JSON.stringify({ error: 'parse failed', raw: content }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

    // 2. Save mosaic image to R2
    const id = crypto.randomUUID();
    const imageKey = 'hair/' + id + '.jpg';
    const b64 = body.image.replace(/^data:image\/\w+;base64,/, '');
    const imgBytes = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
    await env.HAIR_BUCKET.put(imageKey, imgBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    // 3. Save to D1
    await env.DB.prepare(
      `INSERT INTO hairstyles (id, style_name_ko, style_name_en, length, texture, color, face_types, difficulty,
        care_tips, cost_cut_min, cost_cut_max, cost_perm_min, cost_perm_max, cost_color_min, cost_color_max,
        monthly_care, salon_keywords, gguan_ggyu_score, full_analysis, image_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, analysis.style_name_ko||'미분류', analysis.style_name_en||'', analysis.length||'',
      analysis.texture||'', analysis.color||'', JSON.stringify(analysis.face_types||[]),
      analysis.difficulty||3, JSON.stringify(analysis.care_tips||{}),
      analysis.cost_cut_min||0, analysis.cost_cut_max||0, analysis.cost_perm_min||0,
      analysis.cost_perm_max||0, analysis.cost_color_min||0, analysis.cost_color_max||0,
      analysis.monthly_care||0, analysis.salon_keywords||'', analysis.gguan_ggyu_score??50,
      JSON.stringify(analysis), imageKey
    ).run();

    return new Response(JSON.stringify({ id, analysis, imageUrl: '/api/hair/image/' + id }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
