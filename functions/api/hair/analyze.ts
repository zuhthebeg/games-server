interface Env { DB: D1Database; HAIR_BUCKET: R2Bucket; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const HAIR_REF = `== 2025-2026 한국 헤어스타일 트렌드 레퍼런스 ==
[핵심 키워드] 꾸안꾸, 텍스처, 자연스러운 질감, 개성, 레이어드, 거지존(=롭)이 유행

[여성 - 2026 트렌드 TOP]
- 롭(Lob): 거지존 중단발이 대세. 어깨~쇄골 기장, 끝라인 자연스럽게 흐르도록 커트, 매트 텍스처로 꾸안꾸. 슬기/카리나/카즈하 스타일
- 엘리자벳펌: 안쪽으로 말린 클래식 펌. 제니/미야오 착용. 둥근얼굴=얼굴 갸름효과. 볼살패인형은 바깥웨이브 추천
- 빈티지웨이브펌: 자연스러운 S컬, 메시걸/타이어드걸 트렌드. 얼굴형 무관. 자고일어난듯한 자연스러움
- 그레이스펌: 젤리펌처럼 통통+차분한 마무리. 장원영(클래식)/리사(캐주얼). 앞머리 있어도 OK
- 하이레이어드컷: 2025부터 계속. 가벼움+자연스러운 볼륨
- 바로크보브(Baroque Bob): 풍성+생동감 단발
- 리비에라보브(Riviera Bob): 세련된 단발
- 카우걸컷(Cowgirl Cut): 레이어+가벼움
- 빅시컷(Bixie Cut): 밥+픽시 혼합
- 팅커벨커트: 짧고 개성있는 숏컷
- 샤기레이어드: 숱많이치고 층감, 시크 (수영 스타일)
- 커튼뱅: 얼굴선 따라 넘기는 앞머리, 캐주얼
- 컬러멜팅: 자연스러운 그라데이션 염색 (Vogue 2026 주목 트렌드)

[여성 - 기본 스타일]
- 숏컷/보이시컷, 픽시컷, 숏단발/턱선보브, 허쉬컷(멀릿변형)
- 레이어드밥, 허그펌(안쪽감기), 히피펌(S컬복고), 물결펌, 빌드펌(뿌리볼륨+끝C컬)
- 롱레이어드, 바디펌, 글램펌, 일자커트/원렝스, 태슬컷

[남성 - 2026 트렌드 TOP]
- 세미리프컷: 리프컷 변형, 자연스러운 앞머리+옆볼륨. 긴얼굴형 추천
- 드랍컷: 뒤에서 앞으로 자연스럽게 떨어지는 기장감
- 루이펌: 부드러운 웨이브+볼륨, 자연스러운 C컬
- 크리드컷: 텍스처 살린 숏컷, 남성미
- 밴드스타일: 부드러운 가르마+텍스처
- 뉴펑크: 개성강한, 완벽고정보다 바람에 흩날리는 스타일
- 시스루댄디컷: 앞머리 내리는 댄디, 긴얼굴형
- 키워드: '디테일과 자연스러움', 젠더리스 분위기

[남성 - 기본 스타일]
- 댄디컷, 투블럭, 리프컷, 포마드/슬릭백
- 가르마펌, 쉐도우펌(뿌리볼륨), 에즈펌(곱슬텍스처), 크롭컷, 울프컷

[컬러 트렌드 2026]
- 컬러멜팅: 2색 이상 자연스러운 그라데이션 (Vogue 주목)
- 다크브라운/애쉬브라운: 꾸안꾸 기본
- 톤다운컬러: 차분하고 고른 컬러감
- 블론드/하이라이트: 캐주얼+스트릿

[비용 - 서울 2026 평균]
여성: 컷2-5만/펌6-18만/염색5-25만/매월관리2-5만
남성: 컷1.5-3만/펌3-8만/염색3-10만/매월관리1-3만

[난이도] 1:자연건조OK 2:드라이필수 3:드라이+제품 4:매일스타일링 5:전문관리
[꾸안꾸 기준] 90+:자연건조예쁨 70-89:드라이만OK 50-69:제품필요 30-49:매일필수 0-29:유지어려움

[얼굴형 매칭]
- 둥근형: 안쪽C컬(엘리자벳펌), 사이드볼륨↓, 세로길이 강조
- 긴형: 시스루뱅, 옆볼륨↑(세미리프컷), 가로분산
- 각진형: 부드러운 웨이브, 커튼뱅, 레이어드로 라인 부드럽게
- 하트형: 롭, C컬, 턱선 감싸는 길이
- 계란형: 만능, 대부분 스타일 OK`;

const VISION_PROMPT = `You are a top Korean hair stylist with 20 years experience at a Gangnam salon.
Analyze the hairstyle in this photo using the latest 2025-2026 Korean trend data below.

${HAIR_REF}

Return ONLY a JSON object (no markdown fences, no explanation):
{
  "style_name_ko": "정확한 한국 스타일명 (위 트렌드에서 매칭, 예: 롭, 엘리자벳펌, 세미리프컷)",
  "style_name_en": "English name",
  "length": "short|medium|long",
  "texture": "straight|wavy|curly|coily",
  "color": "자연흑|다크브라운|애쉬브라운|하이라이트|블론드|컬러멜팅|etc",
  "face_types": ["어울리는 얼굴형"],
  "difficulty": 3,
  "care_tips": {
    "daily": "매일 관리법 (구체적: 드라이 온도/방향, 제품 사용법)",
    "weekly": "주간 관리법 (트리트먼트 종류, 주기)",
    "products": ["열보호 스프레이", "볼륨 무스", "왁스 종류 등 구체적"],
    "drying": "드라이 방법 (찬바람/온풍 비율, 방향, 팁)",
    "styling": "스타일링 팁 (아이롱 온도, 컬 방향, 마무리)"
  },
  "cost_cut_min": 20000, "cost_cut_max": 40000,
  "cost_perm_min": 0, "cost_perm_max": 0,
  "cost_color_min": 0, "cost_color_max": 0,
  "monthly_care": 30000,
  "salon_keywords": "미용실에서 이렇게 말하세요: (실제 주문 멘트, 예: '어깨선에서 2cm 아래로 롭 기장, 끝에 자연스러운 C컬, 레이어는 턱선부터')",
  "gguan_ggyu_score": 75,
  "gguan_ggyu_reason": "꾸안꾸 판정 이유 (한국어 2-3문장, 관리 노력/자연스러움/스타일링 필요도 기준)",
  "trend_note": "2026 트렌드 관점에서 한 줄 코멘트 (예: '올해 거지존 롭 열풍의 정석')"
}

Rules:
- MUST match to closest style from the trend reference above
- If permed: identify specific perm type (엘리자벳/빈티지웨이브/그레이스/빌드/가르마/etc)
- cost fields: 0 if not applicable (e.g. no perm needed)
- salon_keywords: write as if speaking to a Korean hairdresser, with specific measurements
- trend_note: relate to 2025-2026 trends specifically`;

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
