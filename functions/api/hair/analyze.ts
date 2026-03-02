interface Env { DB: D1Database; HAIR_BUCKET: R2Bucket; JWT_SECRET: string; }
import { verifyJWT, extractBearerToken } from '../../lib/auth';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

const HAIR_REF = `== 2025-2026 한국 헤어스타일 트렌드 레퍼런스 ==
[핵심 키워드] 꾸안꾸, 텍스처, 자연스러운 질감, 개성, 레이어드, 거지존(=롭)이 유행

[여성 - 2026 트렌드 TOP]
- 롭(Lob): 거지존 중단발이 대세. 어깨~쇄골 기장, 끝라인 자연스럽게 흐르도록 커트, 매트 텍스처로 꾸안꾸
- 엘리자벳펌: 안쪽으로 말린 클래식 펌. 둥근얼굴=갸름효과
- 빈티지웨이브펌: 자연스러운 S컬, 메시걸 트렌드. 얼굴형 무관
- 그레이스펌: 통통+차분한 마무리. 앞머리 있어도 OK
- 하이레이어드컷: 가벼움+자연스러운 볼륨
- 바로크보브/리비에라보브: 풍성 단발
- 카우걸컷/빅시컷/팅커벨커트: 개성 숏
- 샤기레이어드: 숱치고 층감, 시크
- 컬러멜팅: 자연스러운 그라데이션 염색 (Vogue 2026)

[여성 - 기본]
- 숏컷, 픽시컷, 숏단발, 허쉬컷, 레이어드밥, 허그펌, 히피펌, 물결펌, 빌드펌, 롱레이어드, 바디펌, 글램펌, 원렝스, 태슬컷

[남성 - 2026 트렌드 TOP]
- 세미리프컷: 자연스러운 앞머리+옆볼륨
- 드랍컷/루이펌/크리드컷/밴드스타일
- 키워드: 디테일과 자연스러움, 젠더리스

[남성 - 기본]
- 댄디컷, 투블럭, 리프컷, 포마드, 가르마펌, 쉐도우펌, 에즈펌, 크롭컷, 울프컷

[컬러] 컬러멜팅, 다크브라운, 애쉬브라운, 톤다운, 블론드, 하이라이트, 발레아쥬
[비용-서울2026] 여:컷2-5만/펌6-18만/염색5-25만 남:컷1.5-3만/펌3-8만/염색3-10만
[난이도] 1:자연건조OK 2:드라이필수 3:드라이+제품 4:매일스타일링 5:전문관리
[꾸안꾸] 90+:자연건조예쁨 70-89:드라이만OK 50-69:제품필요 30-49:매일필수 0-29:유지어려움
[얼굴형] 둥근:안쪽C컬 긴:시스루뱅+옆볼륨 각진:웨이브+커튼뱅 하트:롭+C컬 계란:만능`;

const VISION_PROMPT = `You are a top Korean hair stylist with 20 years experience.
Analyze the hairstyle using 2025-2026 Korean trend data:

${HAIR_REF}

Return ONLY JSON (no fences):
{
  "style_name_ko": "정확한 한국 스타일명",
  "style_name_en": "English name",
  "length": "short|medium|long",
  "texture": "straight|wavy|curly|coily",
  "color": "컬러",
  "face_types": ["어울리는 얼굴형"],
  "difficulty": 3,
  "care_tips": {
    "daily": "매일 관리법 (드라이 온도/방향, 제품)",
    "weekly": "주간 관리법",
    "products": ["구체적 제품명"],
    "drying": "드라이 방법",
    "styling": "스타일링 팁"
  },
  "cost_cut_min": 20000, "cost_cut_max": 40000,
  "cost_perm_min": 0, "cost_perm_max": 0,
  "cost_color_min": 0, "cost_color_max": 0,
  "monthly_care": 30000,
  "salon_keywords": "미용실 주문 멘트 (구체적 기장/레이어/숱 지시)",
  "gguan_ggyu_score": 75,
  "gguan_ggyu_reason": "꾸안꾸 판정 이유 2-3문장",
  "trend_note": "2026 트렌드 관점 한 줄 코멘트",
  "is_valid_hair_photo": true,
  "rejection_reason": null
}

CRITICAL SAFETY RULES:
- Set is_valid_hair_photo=false if the image contains: nudity, sexually explicit content, violence, gore, minors in inappropriate context, hate symbols, non-human subjects, memes, or NO visible hair/hairstyle
- If is_valid_hair_photo=false, set rejection_reason (Korean) and leave all other fields as defaults
- Only analyze actual photos showing a person's hair/hairstyle`;

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // Optional auth
    let userId: string | null = null;
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    if (token) {
      try {
        const payload = await verifyJWT(token, env.JWT_SECRET);
        if (payload) userId = payload.sub as string;
      } catch {}
    }

    // Require login for analyze
    if (!userId) {
      return new Response(JSON.stringify({ error: '로그인이 필요합니다' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

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

    // Content moderation check
    if (analysis.is_valid_hair_photo === false) {
      return new Response(JSON.stringify({ error: 'rejected', reason: analysis.rejection_reason || '헤어스타일 사진이 아닙니다' }), { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const id = crypto.randomUUID();
    const imageKey = 'hair/' + id + '.jpg';
    const b64 = body.image.replace(/^data:image\/\w+;base64,/, '');
    const imgBytes = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
    await env.HAIR_BUCKET.put(imageKey, imgBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    await env.DB.prepare(
      `INSERT INTO hairstyles (id, style_name_ko, style_name_en, length, texture, color, face_types, difficulty,
        care_tips, cost_cut_min, cost_cut_max, cost_perm_min, cost_perm_max, cost_color_min, cost_color_max,
        monthly_care, salon_keywords, gguan_ggyu_score, full_analysis, image_key, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, analysis.style_name_ko||'미분류', analysis.style_name_en||'', analysis.length||'',
      analysis.texture||'', analysis.color||'', JSON.stringify(analysis.face_types||[]),
      analysis.difficulty||3, JSON.stringify(analysis.care_tips||{}),
      analysis.cost_cut_min||0, analysis.cost_cut_max||0, analysis.cost_perm_min||0,
      analysis.cost_perm_max||0, analysis.cost_color_min||0, analysis.cost_color_max||0,
      analysis.monthly_care||0, analysis.salon_keywords||'', analysis.gguan_ggyu_score??50,
      JSON.stringify(analysis), imageKey, userId
    ).run();

    return new Response(JSON.stringify({ id, analysis, imageUrl: '/api/hair/image/' + id }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
