/**
 * 범용 LLM 번역/비전 API
 * POST /api/llm/translate
 * 
 * 웹툰 번역 등 외부 Chrome 확장에서 호출
 * Anthropic Claude (Opus) via CF AI Gateway
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  LLM_AUTH_TOKEN: string; // 확장 인증용 토큰
}

interface TranslateRequest {
  // 텍스트 번역
  text?: string;
  // 이미지 비전 (base64 or URL)
  image?: string;
  imageUrl?: string;
  // 번역 설정
  sourceLang?: string;
  targetLang?: string;
  // 커스텀 프롬프트 (번역 대신 자유 요청)
  prompt?: string;
  // 시스템 프롬프트 오버라이드
  systemPrompt?: string;
  // 모델 선택 (기본: claude-sonnet-4-20250514)
  model?: string;
  // 용어집 (key: 원문, value: 번역)
  glossary?: Record<string, string>;
  // 컨텍스트 (이전 번역, 작품 설명 등)
  context?: string;
  // max tokens
  maxTokens?: number;
}

const ANTHROPIC_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/3d0681b782422e56226a0a1df4a0e8b2/travly-ai-gateway/anthropic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function buildMessages(req: TranslateRequest): any[] {
  const content: any[] = [];

  // 이미지 추가 (비전)
  if (req.image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: req.image.replace(/^data:image\/\w+;base64,/, ''),
      },
    });
  } else if (req.imageUrl) {
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url: req.imageUrl,
      },
    });
  }

  // 텍스트/프롬프트 추가
  if (req.prompt) {
    content.push({ type: 'text', text: req.prompt });
  } else if (req.text) {
    const srcLang = req.sourceLang || '한국어';
    const tgtLang = req.targetLang || '영어';
    
    let prompt = `다음 ${srcLang} 텍스트를 ${tgtLang}로 번역해주세요. 번역문만 출력하세요.\n\n`;
    
    if (req.glossary && Object.keys(req.glossary).length > 0) {
      prompt += `**용어집 (반드시 준수):**\n`;
      for (const [src, tgt] of Object.entries(req.glossary)) {
        prompt += `- ${src} → ${tgt}\n`;
      }
      prompt += '\n';
    }
    
    if (req.context) {
      prompt += `**컨텍스트:** ${req.context}\n\n`;
    }
    
    prompt += `**원문:**\n${req.text}`;
    content.push({ type: 'text', text: prompt });
  }

  return [{ role: 'user', content }];
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // 인증 체크
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (!token || token !== env.LLM_AUTH_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: CORS_HEADERS }
    );
  }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body: TranslateRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!body.text && !body.image && !body.imageUrl && !body.prompt) {
    return new Response(
      JSON.stringify({ error: 'text, image, imageUrl, or prompt required' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const model = body.model || 'claude-sonnet-4-20250514';
  const maxTokens = body.maxTokens || 4096;
  const systemPrompt = body.systemPrompt || 
    '당신은 전문 웹툰 번역가입니다. 자연스럽고 매끄러운 번역을 제공하세요. 캐릭터의 말투와 감정을 살려 번역하세요.';

  const messages = buildMessages(body);

  try {
    const response = await fetch(`${ANTHROPIC_GATEWAY_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ 
          error: 'Anthropic API error', 
          status: response.status,
          detail: errorText 
        }),
        { status: response.status, headers: CORS_HEADERS }
      );
    }

    const result: any = await response.json();
    const translatedText = result.content?.[0]?.text || '';

    return new Response(
      JSON.stringify({
        result: translatedText,
        model,
        usage: result.usage,
      }),
      { headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Request failed', detail: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
