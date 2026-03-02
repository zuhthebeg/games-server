interface Env { DB: D1Database; HAIR_BUCKET: R2Bucket; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const HAIR_REF = `== 한국 인기 헤어스타일 레퍼런스 ==
[여성 숏] 숏컷/보이시컷, 픽시컷, 숏단발/턱선보브, 허쉬컷
[여성 미디엄] 레이어드밥, 허그펌, 히피펌, 물결펌, 빌드펌, 레이어드컷, 허쉬컷(미디엄)
[여성 롱] 롱레이어드, 히피펌(롱), 바디펌, 글램펌, 일자커트/원렝스, 태슬컷
[남성] 댄디컷, 투블럭, 리프컷, 포마드/슬릭백, 가르마펌, 쉐도우펌, 에즈펌, 크롭컷, 울프컷
[컬러] 자연흑, 다크브라운, 애쉬브라운/그레이, 하이라이트, 발레아쥬, 블론드
[난이도] 1:자연건조OK 2:드라이필수 3:드라이+제품 4:매일스타일링 5:전문관리
[꾸안꾸] 90+:자연건조예쁨 70-89:드라이만OK 50-69:제품필요 30-49:매일필수 0-29:유지어려움
[비용참고-서울2026] 여성컷2-5만/남성컷1.5-3만/펌5-18만/염색4-25만`;

const VISION_PROMPT = `You are a Korean hair salon professional with 15 years experience. Analyze the hairstyle in this photo.

Reference data for Korean hairstyles:
${HAIR_REF}

Return ONLY a JSON object (no markdown fences):
{
  "style_name_ko": "정확한 한국 스타일명 (위 레퍼런스 참고, 예: 레이어드밥, 투블럭, 허그펌)",
  "style_name_en": "English name",
  "length": "short|medium|long",
  "texture": "straight|wavy|curly|coily",
  "color": "자연흑|다크브라운|애쉬브라운|하이라이트|etc",
  "face_types": ["어울리는 얼굴형"],
  "difficulty": 3,
  "care_tips": {
    "daily": "매일 관리법 (구체적으로)",
    "weekly": "주간 관리법",
    "products": ["열보호 스프레이", "볼륨 무스 등 구체적 제품"],
    "drying": "드라이 방법 (온도, 방향 등)",
    "styling": "스타일링 팁"
  },
  "cost_cut_min": 15000, "cost_cut_max": 30000,
  "cost_perm_min": 50000, "cost_perm_max": 120000,
  "cost_color_min": 0, "cost_color_max": 0,
  "monthly_care": 30000,
  "salon_keywords": "미용실에서 이렇게 말하세요: (구체적 주문 멘트)",
  "gguan_ggyu_score": 75,
  "gguan_ggyu_reason": "꾸안꾸 판정 이유 (한국어, 2-3문장, 구체적으로)"
}

Rules:
- Match to closest known Korean hairstyle name from reference
- If permed, identify perm type specifically (허그펌/히피펌/빌드펌/etc)
- cost_color: 0 if natural color
- Be specific about products (brand types, not generic)
- salon_keywords: actual phrases to say at Korean salon`;

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as any;
    if (!body.image || !body.imageOriginal)
      return new Response(JSON.stringify({ error: 'image and imageOriginal required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

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
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return new Response(JSON.stringify({ error: 'AI failed', status: llmRes.status, detail: errText.substring(0, 500) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const llmData = await llmRes.json() as any;
    const content = llmData.choices?.[0]?.message?.content || '';
    let analysis: any;
    try { analysis = JSON.parse(content.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()); }
    catch { return new Response(JSON.stringify({ error: 'parse failed', raw: content.substring(0, 500) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

    const id = crypto.randomUUID();
    const imageKey = 'hair/' + id + '.jpg';
    const b64 = body.image.replace(/^data:image\/\w+;base64,/, '');
    const imgBytes = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
    await env.HAIR_BUCKET.put(imageKey, imgBytes, { httpMetadata: { contentType: 'image/jpeg' } });

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
    return new Response(JSON.stringify({ error: e.message, stack: (e.stack||'').substring(0, 300) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
