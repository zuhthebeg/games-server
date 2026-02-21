/**
 * 공용 보스 대화 API
 * POST /api/llm/boss
 * 
 * 보스 몬스터가 플레이어를 기억하고 대사 + 행동을 결정
 * encounter 기록을 D1에 저장 (FIFO, 최근 20개)
 */

interface Env {
  DB: D1Database;
  GEMINI_API_KEY: string;
}

interface BossRequest {
  playerId: string;       // 플레이어 식별자
  bossId: string;         // 보스 몬스터 ID (dragon, demon_lord 등)
  bossName: string;       // 보스 이름
  bossTier: number;       // 보스 티어 (4~6)
  playerWeapon: string;   // 무기 이름
  playerLevel: number;    // 강화 단계
  playerGrade: string;    // 등급 (일반, 고급 등)
  playerGold: number;     // 보유 골드
  playerElement?: string; // 무기 속성
  playerWeaponType?: string; // 무기 종류 (sword, axe, bow 등)
  bossType?: string;      // 보스 몬스터 타입 (dragon, demon, undead 등)
  gameId?: string;        // 게임 식별자 (다른 게임에서도 쓸 수 있도록)
}

interface BossResponse {
  dialogue: string;       // 보스 대사
  action: string;         // 행동: normal_attack, special_skill, taunt, gift, flee
  skillName?: string;     // 특수 스킬 이름
  skillEffect?: string;   // 스킬 효과 설명
  goldGift?: number;      // 골드 선물 (gift 액션일 때)
  emotion?: string;       // 감정: angry, amused, scared, bored, excited
}

const GEMINI_URL = 'https://gateway.ai.cloudflare.com/v1/3d0681b782422e56226a0a1df4a0e8b2/travly-ai-gateway/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

interface BossPersona {
  style: string;
  tone: string;
  signature: string;
  favoredActions: string;
}

const BOSS_PERSONAS: Record<string, BossPersona> = {
  valakas: {
    style: '압도적이고 오만한 제왕형 말투',
    tone: '뜨겁고 위협적, 불길/멸망 어휘 선호',
    signature: '약자를 벌레 취급, 강자만 인정',
    favoredActions: 'special_skill, taunt'
  },
  antharas: {
    style: '묵직하고 느린 고대 지룡 말투',
    tone: '대지, 진동, 무게감 표현',
    signature: '짧고 단단한 경고',
    favoredActions: 'normal_attack, taunt'
  },
  lindvior: {
    style: '빠르고 날카로운 사냥꾼형 말투',
    tone: '바람, 속도, 절단 표현',
    signature: '비웃음 + 기습 예고',
    favoredActions: 'special_skill, taunt'
  },
  fafurion: {
    style: '차갑고 침착한 심해 군주 말투',
    tone: '파도, 압력, 침수 표현',
    signature: '상대를 천천히 익사시키는 이미지',
    favoredActions: 'normal_attack, special_skill'
  },
  demon_lord: {
    style: '폭군형 악마 왕',
    tone: '지배, 복종, 처형 어휘',
    signature: '명령형 대사',
    favoredActions: 'taunt, special_skill'
  },
  demon_queen: {
    style: '치명적으로 우아한 여왕형',
    tone: '유혹 + 조롱을 섞은 냉소',
    signature: '상대를 장난감 취급',
    favoredActions: 'taunt, special_skill'
  },
  succubus_queen: {
    style: '유혹적이지만 잔혹한 여왕형',
    tone: '달콤한 표현 뒤에 살기',
    signature: '칭찬처럼 들리지만 모욕',
    favoredActions: 'taunt, gift, special_skill'
  },
  incubus: {
    style: '여유롭고 도발적인 미남형',
    tone: '비꼬는 농담 + 자신감',
    signature: '한 수 위라는 태도',
    favoredActions: 'taunt, normal_attack'
  },
  death_knight: {
    style: '침착한 기사단장형',
    tone: '의식, 심판, 단죄 어휘',
    signature: '짧은 판결문 같은 대사',
    favoredActions: 'normal_attack, special_skill'
  },
  lich: {
    style: '냉소적인 망령 군주',
    tone: '죽음, 저주, 영혼 수집',
    signature: '비웃는 듯한 지식인 말투',
    favoredActions: 'special_skill, taunt'
  },
  reaper: {
    style: '무감정한 사형집행인',
    tone: '종말, 수확, 마지막 숨',
    signature: '짧은 사망선고',
    favoredActions: 'normal_attack, taunt'
  },
  dragon: {
    style: '난폭한 포식자형 드래곤',
    tone: '불, 송곳니, 찢어발김',
    signature: '직선적 위협',
    favoredActions: 'normal_attack, special_skill'
  },
  demon: {
    style: '광폭한 전장 악마',
    tone: '분노, 파괴, 학살',
    signature: '호전적 도발',
    favoredActions: 'normal_attack, taunt'
  },
};

const DEFAULT_PERSONA: BossPersona = {
  style: '위압적인 RPG 보스',
  tone: '강하고 거친 전투 말투',
  signature: '플레이어를 낮춰보고 도발',
  favoredActions: 'normal_attack, taunt'
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<BossRequest>();
    const { playerId, bossId, bossName, bossTier, playerWeapon, playerLevel, playerGrade, playerGold, playerElement, playerWeaponType, bossType, gameId } = body;

    if (!playerId || !bossId || !bossName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS_HEADERS });
    }

    // 1. 과거 encounter 기록 가져오기 (최근 20개)
    const history = await getEncounterHistory(context.env.DB, playerId, bossId, 20);

    // 2. Gemini에 보스 대사 요청
    const bossResponse = await generateBossDialogue(
      context.env.GEMINI_API_KEY,
      { bossId, bossName, bossTier, playerWeapon, playerLevel, playerGrade, playerGold, playerElement, playerWeaponType, bossType },
      history
    );

    // 3. encounter 기록 저장
    await saveEncounter(context.env.DB, playerId, bossId, bossName, bossResponse, playerLevel, playerGold, gameId);

    // 4. 오래된 기록 정리 (FIFO: 20개 초과 시 삭제)
    await pruneEncounters(context.env.DB, playerId, bossId, 20);

    return new Response(JSON.stringify(bossResponse), { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Boss dialogue error:', error);
    // 에러 시 기본 대사 반환 (게임이 멈추면 안 되니까)
    const errMsg = error instanceof Error ? error.message : 'unknown';
    return new Response(JSON.stringify({
      dialogue: '크큭... 감히 이곳에 발을 들이다니.',
      action: 'normal_attack',
      emotion: 'angry',
      _debug: errMsg
    }), { headers: CORS_HEADERS });
  }
};

async function generateBossDialogue(
  apiKey: string,
  player: { bossId: string; bossName: string; bossTier: number; playerWeapon: string; playerLevel: number; playerGrade: string; playerGold: number; playerElement?: string; playerWeaponType?: string; bossType?: string },
  history: EncounterRecord[]
): Promise<BossResponse> {
  const encounterCount = history.length;
  const historyContext = history.length > 0
    ? history.map((h, i) => `${i + 1}회차: 플레이어 무기 +${h.player_level}, 골드 ${h.player_gold}, 보스 행동: ${h.boss_action}, 보스 대사: "${h.boss_dialogue}"`).join('\n')
    : '첫 만남';

  // 속성 상성 정보
  const WEAKNESSES: Record<string, string[]> = {
    beast: ['fire'], undead: ['silver', 'holy', 'fire'], demon: ['holy', 'lightning'],
    elemental: ['lightning'], humanoid: ['poison'], dragon: ['ice'], insect: ['fire', 'ice']
  };
  const bossWeaknesses = player.bossType ? (WEAKNESSES[player.bossType] || []) : [];
  const playerHasAdvantage = player.playerElement && bossWeaknesses.includes(player.playerElement);
  const playerHasDisadvantage = player.playerElement === 'fire' && player.bossType === 'dragon';

  const persona = BOSS_PERSONAS[player.bossId] || BOSS_PERSONAS[player.bossType || ''] || DEFAULT_PERSONA;

  const prompt = `RPG 보스 "${player.bossName}"(${player.bossType||'?'}, 티어${player.bossTier}) 역할. ${encounterCount+1}번째 조우.
플레이어: ${player.playerWeapon} +${player.playerLevel} ${player.playerGrade}, ${player.playerWeaponType||'sword'}, 속성:${player.playerElement||'무'}, ${player.playerGold}G
약점:${bossWeaknesses.join(',')||'없음'} ${playerHasAdvantage?'플레이어유리!':''} ${playerHasDisadvantage?'보스유리!':''}
${history.length > 0 ? '이전:' + history.slice(-3).map(h=>`+${h.player_level},${h.boss_action}`).join('/') : '첫만남'}

보스 페르소나:
- 말투: ${persona.style}
- 분위기: ${persona.tone}
- 캐릭터 핵심: ${persona.signature}
- 선호 행동: ${persona.favoredActions}

규칙:
- 한국어 반말, 16~28자 짧은 대사
- 보스 본연의 캐릭터를 유지 (매번 같은 느낌)
- 무기/속성/강화 단계에 반드시 반응
- +0이면 action:gift, goldGift:10000
- +7 이상이면 플레이어를 경계/긴장
- 골드 10만 이상이면 탐욕 반응
- action은 normal_attack|special_skill|taunt|gift|flee 중 하나
- emotion은 angry|amused|scared|bored|excited 중 하나

순수JSON만! {"dialogue":"대사","action":"normal_attack","emotion":"angry"}`;

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');
  try {
    // JSON 블록 추출 (```json ... ``` 또는 { ... } 매칭)
    let jsonStr = text;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      jsonStr = codeBlock[1].trim();
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    return {
      dialogue: (parsed.dialogue || '...').replace(/^dialogue:\s*/i, '').trim(),
      action: parsed.action || 'normal_attack',
      skillName: parsed.skillName,
      skillEffect: parsed.skillEffect,
      goldGift: parsed.goldGift,
      emotion: parsed.emotion || 'angry',
    };
  } catch (parseErr) {
    // JSON 파싱 실패 시 텍스트에서 대사 추출 시도
    const dialogueMatch = text.match(/"dialogue"\s*:\s*"([^"]+)"/);
    if (dialogueMatch) {
      const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
      const emotionMatch = text.match(/"emotion"\s*:\s*"([^"]+)"/);
      return {
        dialogue: dialogueMatch[1],
        action: actionMatch?.[1] || 'normal_attack',
        emotion: emotionMatch?.[1] || 'angry',
      };
    }
    const clean = text.replace(/```[\s\S]*?```/g, '').replace(/[{}"\n]/g, '').trim();
    return { dialogue: clean.substring(0, 100) || '크큭...', action: 'normal_attack', emotion: 'angry' };
  }
}

interface EncounterRecord {
  id: number;
  player_id: string;
  boss_id: string;
  boss_dialogue: string;
  boss_action: string;
  player_level: number;
  player_gold: number;
  created_at: string;
}

async function getEncounterHistory(db: D1Database, playerId: string, bossId: string, limit: number): Promise<EncounterRecord[]> {
  try {
    const { results } = await db.prepare(
      'SELECT * FROM boss_encounters WHERE player_id = ? AND boss_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(playerId, bossId, limit).all<EncounterRecord>();
    return (results || []).reverse(); // 시간순 정렬
  } catch {
    // 테이블 없으면 빈 배열
    return [];
  }
}

async function saveEncounter(
  db: D1Database, playerId: string, bossId: string, bossName: string,
  response: BossResponse, playerLevel: number, playerGold: number, gameId?: string
) {
  try {
    await db.prepare(
      `INSERT INTO boss_encounters (player_id, boss_id, boss_name, boss_dialogue, boss_action, boss_emotion, player_level, player_gold, game_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(playerId, bossId, bossName, response.dialogue, response.action, response.emotion || 'angry', playerLevel, playerGold, gameId || 'enhance').run();
  } catch (e) {
    console.error('Failed to save encounter:', e);
  }
}

async function pruneEncounters(db: D1Database, playerId: string, bossId: string, keep: number) {
  try {
    await db.prepare(
      `DELETE FROM boss_encounters WHERE player_id = ? AND boss_id = ? AND id NOT IN (
        SELECT id FROM boss_encounters WHERE player_id = ? AND boss_id = ? ORDER BY created_at DESC LIMIT ?
      )`
    ).bind(playerId, bossId, playerId, bossId, keep).run();
  } catch {
    // ignore
  }
}
