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
      dialogue: '아 진짜 또야...',
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

  const repeatedVisit = encounterCount >= 3;
  const tooRich = player.playerGold >= 100000;
  const highLevel = player.playerLevel >= 9;
  const lowLevel = player.playerLevel <= 2;
  const comesAgain = encounterCount >= 1;

  const prompt = `RPG 보스 "${player.bossName}"(티어${player.bossTier}) 역할극. ${encounterCount+1}번째 조우.
상황: ${player.playerWeapon} +${player.playerLevel} ${player.playerGrade}, 속성:${player.playerElement||'무'}, 골드:${player.playerGold}G
${history.length > 0 ? '최근내역: ' + history.slice(-3).map(h=>`+${h.player_level} [${h.boss_action}]`).join('→') : '첫만남'}
약점:${bossWeaknesses.join(',')||'없음'} ${playerHasAdvantage?'[플레이어 속성유리]':''} ${playerHasDisadvantage?'[보스 속성유리]':''}

페르소나: ${persona.style} / ${persona.signature}

=== 대사 스타일 (핵심!) ===
이 보스는 맨날 사냥당하는 처지라 피로감이 극심함. 뻔한 악당 대사(크큭/감히/멸망/두려워하라) 완전 금지.
대신 이런 느낌으로:
- 귀찮아/지침: "아 진짜 또야", "내새끼들 고만때려", "오늘만 몇번째임"
- 협박 대신 흥정: "나말고 딴 보스 때려 돈줄게", "그냥 가면 골드 드림", "딜 하나 하자"
- 현실적 불평: "손가락 안 아프냐 진짜", "이게 직업이냐", "몇시간째 파밍이냐"
- 낮은강화 무시: "+${player.playerLevel}강이 감히? ㅋ", "장난치냐", "그거 가지고 왔어?"
- 높은강화 당황: "+${player.playerLevel}이라고? 잠깐만", "야 그 무기 사기 아님?", "진심임?"
- 돈 많으면 비꼬기: "${Math.floor(player.playerGold/10000)}만골드 있으면서 왜 나한테 옴"
- 한국어 인터넷 반말 허용: ㅋㅋ, ㅜㅜ, 진짜로?, 레알?, 어이없어, 씁, 하
${comesAgain ? `- 재방문 피로: "형이라 부를게 제발 그만와", "또 왔냐 진짜"` : ''}

글자 수: 한국어 10~25자 딱 맞춰서. 짧고 찰지게.

규칙:
- +0강이면 반드시 action:gift, goldGift:10000 (불쌍해서 줌)
- action: normal_attack|special_skill|taunt|gift|flee
- emotion: angry|amused|scared|bored|excited

JSON만 출력: {"dialogue":"대사","action":"normal_attack","emotion":"amused"}`;

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
    return { dialogue: clean.substring(0, 100) || '...진짜 또야', action: 'normal_attack', emotion: 'bored' };
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
