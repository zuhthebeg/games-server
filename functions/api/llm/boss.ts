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
    const { playerId, bossId, bossName, bossTier, playerWeapon, playerLevel, playerGrade, playerGold, playerElement, gameId } = body;

    if (!playerId || !bossId || !bossName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS_HEADERS });
    }

    // 1. 과거 encounter 기록 가져오기 (최근 20개)
    const history = await getEncounterHistory(context.env.DB, playerId, bossId, 20);

    // 2. Gemini에 보스 대사 요청
    const bossResponse = await generateBossDialogue(
      context.env.GEMINI_API_KEY,
      { bossId, bossName, bossTier, playerWeapon, playerLevel, playerGrade, playerGold, playerElement },
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
    return new Response(JSON.stringify({
      dialogue: '크큭... 감히 이곳에 발을 들이다니.',
      action: 'normal_attack',
      emotion: 'angry'
    }), { headers: CORS_HEADERS });
  }
};

async function generateBossDialogue(
  apiKey: string,
  player: { bossId: string; bossName: string; bossTier: number; playerWeapon: string; playerLevel: number; playerGrade: string; playerGold: number; playerElement?: string },
  history: EncounterRecord[]
): Promise<BossResponse> {
  const encounterCount = history.length;
  const historyContext = history.length > 0
    ? history.map((h, i) => `${i + 1}회차: 플레이어 무기 +${h.player_level}, 골드 ${h.player_gold}, 보스 행동: ${h.boss_action}, 보스 대사: "${h.boss_dialogue}"`).join('\n')
    : '첫 만남';

  const prompt = `너는 RPG 게임의 보스 몬스터 "${player.bossName}"이다.
플레이어와 ${encounterCount + 1}번째 조우했다.

## 플레이어 정보
- 무기: ${player.playerWeapon} +${player.playerLevel} (${player.playerGrade})
- 보유 골드: ${player.playerGold.toLocaleString()} G
- 무기 속성: ${player.playerElement || '없음'}
- 보스 티어: ${player.bossTier} (4=보스, 5=전설, 6=신화)

## 과거 조우 기록
${historyContext}

## 규칙
1. 보스 캐릭터에 맞는 대사를 한국어로 1-2문장 만들어라
2. 과거 기록이 있으면 기억하는 것처럼 말해라 ("또 왔냐?", "저번엔 도망갔으면서?" 등)
3. 플레이어 강화 +0이면: "불쌍한 놈" 류의 대사 + action을 "gift"로 설정 + goldGift를 10000으로
4. 플레이어 강화가 높으면(+7 이상): 긴장하거나 분노하는 대사
5. 특수 스킬은 3회 이상 만남부터 가끔 사용 (30% 확률 정도로)
6. 보스 성격: 티어4=위엄있는, 티어5=광기어린, 티어6=고대의 위엄

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
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini ${response.status}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');

  try {
    const parsed = JSON.parse(text);
    return {
      dialogue: parsed.dialogue || '...',
      action: parsed.action || 'normal_attack',
      skillName: parsed.skillName,
      skillEffect: parsed.skillEffect,
      goldGift: parsed.goldGift,
      emotion: parsed.emotion || 'angry',
    };
  } catch {
    return { dialogue: text.substring(0, 100), action: 'normal_attack', emotion: 'angry' };
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
