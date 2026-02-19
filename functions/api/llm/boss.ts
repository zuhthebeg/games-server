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

  const prompt = `너는 RPG 게임의 보스 몬스터 "${player.bossName}"이다. (종족: ${player.bossType || '불명'})
플레이어와 ${encounterCount + 1}번째 조우했다.

## 플레이어 정보
- 무기 이름: ${player.playerWeapon} +${player.playerLevel} (${player.playerGrade})
- 무기 종류: ${player.playerWeaponType || '불명'} (예: sword=검, axe=도끼, bow=활, spear=창, dagger=단검, staff=지팡이, katana=태도, scythe=낫, knuckle=너클)
- 무기 속성: ${player.playerElement || '없음'} (fire=불, ice=얼음, lightning=번개, water=물, poison=독, holy=신성, silver=은)
- 보유 골드: ${player.playerGold.toLocaleString()} G
- 보스 티어: ${player.bossTier} (4=보스, 5=전설, 6=신화)
- 보스 약점: ${bossWeaknesses.join(', ') || '없음'}
- 플레이어 상성 유리: ${playerHasAdvantage ? '⚠️ YES! 보스가 긴장해야 함!' : 'No'}
- 플레이어 상성 불리: ${playerHasDisadvantage ? '😏 보스에게 유리' : 'No'}

## 과거 조우 기록
${historyContext}

## 핵심 규칙: 무기에 대한 리액션을 반드시 넣어라!
- 무기 종류에 반응해라! ("활? 겁쟁이처럼 멀리서 쏘려고?", "검 하나 들고 나한테 덤비겠다고?", "지팡이? 마법사놈이 감히!", "너클? 맨손으로 때릴 셈이냐?")
- 무기 속성에 반응해라! ("불 속성? 나한테 불이 통할 것 같냐?", "신성 무기... 좀 거슬리는군", "얼음? 내 화염에 녹여주마")
- 상성이 유리하면 보스가 위기감을 느껴라! ("그 속성... 어디서 구한 거냐? 좀 불편하군")
- 상성이 불리하면 보스가 비웃어라! ("그 속성으로 나한테? 웃기는 놈")
- 강화 수치에 반응해라! (+0: 불쌍, +3~6: 평범, +7~9: 인정, +10: 경계, +15+: 두려움)

## 추가 규칙
1. 보스 캐릭터에 맞는 대사를 한국어로 1-2문장 만들어라 (반말, 위엄있게)
2. 과거 기록이 있으면 기억하는 것처럼 말해라 ("또 왔냐?", "저번엔 도망갔으면서?", "이번엔 무기를 바꿔왔구나?")
3. 플레이어 강화 +0이면: "불쌍한 놈" 류의 대사 + action을 "gift"로 설정 + goldGift를 10000으로
4. 플레이어 강화가 높으면(+7 이상): 긴장하거나 분노하는 대사
5. 특수 스킬은 3회 이상 만남부터 가끔 사용 (30% 확률 정도로)
6. 보스 성격: 티어4=위엄있는, 티어5=광기어린, 티어6=고대의 위엄
7. 골드가 매우 많으면(100,000+) 탐내는 대사 ("그 골드... 내가 가져야겠군")

## 특수 스킬 예시
- 화염숨결, 저주의 손길, 공간왜곡, 영혼흡수, 냉기의 벽, 번개소환 등

반드시 아래 JSON 형식으로만 응답해라:
{
  "dialogue": "보스 대사",
  "action": "normal_attack|special_skill|taunt|gift|flee",
  "skillName": "스킬 이름 (special_skill일 때만)",
  "skillEffect": "스킬 효과 설명 (special_skill일 때만)",
  "goldGift": 10000 (gift일 때만),
  "emotion": "angry|amused|scared|bored|excited"
}`;

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 300,
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
      dialogue: parsed.dialogue || '...',
      action: parsed.action || 'normal_attack',
      skillName: parsed.skillName,
      skillEffect: parsed.skillEffect,
      goldGift: parsed.goldGift,
      emotion: parsed.emotion || 'angry',
    };
  } catch {
    // JSON 파싱 실패 시 텍스트 자체를 대사로
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
