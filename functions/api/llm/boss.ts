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
  LLM_SECRET: string;
}

interface BossRequest {
  playerId: string;       // 플레이어 식별자
  bossId: string;         // 보스 몬스터 ID (dragon, demon_lord 등)
  bossName?: string;       // 보스 이름 (optional, falls back to bossId)
  bossTier: number;       // 보스 티어 (4~6)
  playerWeapon: string;   // 무기 이름
  playerLevel: number;    // 강화 단계
  playerGrade: string;    // 등급 (일반, 고급 등)
  playerGold: number;     // 보유 골드
  playerElement?: string; // 무기 속성
  playerWeaponType?: string; // 무기 종류 (sword, axe, bow 등)
  bossType?: string;      // 보스 몬스터 타입 (dragon, demon, undead 등)
  gameId?: string;        // 게임 식별자 (다른 게임에서도 쓸 수 있도록)
  percent?: number;       // linerush 영토 점유율
  triggerType?: 'greeting' | 'desperate' | 'normal';
  stage?: number;
  score?: number;
}

interface BossResponse {
  dialogue: string;       // 보스 대사
  action: string;         // 행동: normal_attack, special_skill, taunt, gift, flee
  skillName?: string;     // 특수 스킬 이름
  skillEffect?: string;   // 스킬 효과 설명
  goldGift?: number;      // 골드 선물 (gift 액션일 때)
  emotion?: string;       // 감정: angry, amused, scared, bored, excited
}

interface CrossGameHistorySummary {
  totalEncounters: number;
  byGame: Array<{ gameId: string; total: number; results: Record<string, number> }>;
  latest: { gameId: string; result: string; createdAt: string } | null;
}

const GEMINI_URL = 'https://gateway.ai.cloudflare.com/v1/3d0681b782422e56226a0a1df4a0e8b2/travly-ai-gateway/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent';

// --- 모델 설정 캐싱 ---
const MODEL_CACHE: Record<string, { primary: string; fallback: string; expiry: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000;
async function getModelConfig(service: string): Promise<{ primary: string; fallback: string }> {
  const now = Date.now();
  const cached = MODEL_CACHE[service];
  if (cached && now < cached.expiry) return cached;
  try {
    const res = await fetch(`https://admin-cocy.pages.dev/api/config/${service}`);
    if (res.ok) {
      const data: any = await res.json();
      const config = { primary: data.primary_model || 'spark', fallback: data.fallback_model || 'haiku', expiry: now + CACHE_TTL_MS };
      MODEL_CACHE[service] = config;
      return config;
    }
  } catch { /* 기본값 사용 */ }
  return cached ?? { primary: 'spark', fallback: 'haiku', expiry: 0 };
}

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
    const {
      playerId, bossId, bossName, bossTier, playerWeapon, playerLevel, playerGrade, playerGold,
      playerElement, playerWeaponType, bossType, gameId, percent, triggerType, stage, score,
    } = body;

    if (!playerId || !bossId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS_HEADERS });
    }
    const effectiveBossName = bossName || bossId;

    const effectiveGameId = gameId || 'enhance';

    // 1) 기존 encounter + 크로스게임 컨텍스트 + 보스 성격 조회
    const [history, registryPersonality, crossGameHistory] = await Promise.all([
      getEncounterHistory(context.env.DB, playerId, bossId, 20),
      getBossPersonality(context.env.DB, bossId),
      getCrossGameHistory(context.env.DB, playerId, bossId),
    ]);

    // 2) Gemini에 보스 대사 요청
    const bossResponse = await generateBossDialogue(
      context.env.GEMINI_API_KEY,
      context.env.LLM_SECRET || 'choon150622',
      {
        bossId,
        bossName: effectiveBossName,
        bossTier,
        playerWeapon,
        playerLevel,
        playerGrade,
        playerGold,
        playerElement,
        playerWeaponType,
        bossType,
        gameId: effectiveGameId,
        percent,
        triggerType,
      },
      history,
      registryPersonality,
      crossGameHistory,
    );

    // 3) 기존 encounter 기록 저장
    await saveEncounter(context.env.DB, playerId, bossId, effectiveBossName, bossResponse, playerLevel, playerGold, effectiveGameId);

    // 4) 크로스게임 히스토리에도 기록 저장
    await saveBossPlayerHistory(
      context.env.DB,
      playerId,
      bossId,
      effectiveGameId,
      stage ?? null,
      score ?? (typeof percent === 'number' ? Math.round(percent) : null),
    );

    // 5) 오래된 기록 정리 (FIFO: 20개 초과 시 삭제)
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
  llmSecret: string,
  player: {
    bossId: string;
    bossName: string;
    bossTier: number;
    playerWeapon: string;
    playerLevel: number;
    playerGrade: string;
    playerGold: number;
    playerElement?: string;
    playerWeaponType?: string;
    bossType?: string;
    gameId?: string;
    percent?: number;
    triggerType?: 'greeting' | 'desperate' | 'normal';
  },
  history: EncounterRecord[],
  registryPersonality: string | null,
  crossGameHistory: CrossGameHistorySummary,
): Promise<BossResponse> {
  const encounterCount = history.length;

  // 속성 상성 정보
  const WEAKNESSES: Record<string, string[]> = {
    beast: ['fire'], undead: ['silver', 'holy', 'fire'], demon: ['holy', 'lightning'],
    elemental: ['lightning'], humanoid: ['poison'], dragon: ['ice'], insect: ['fire', 'ice']
  };
  const bossWeaknesses = player.bossType ? (WEAKNESSES[player.bossType] || []) : [];
  const playerHasAdvantage = player.playerElement && bossWeaknesses.includes(player.playerElement);
  const playerHasDisadvantage = player.playerElement === 'fire' && player.bossType === 'dragon';

  const fallbackPersona = BOSS_PERSONAS[player.bossId] || BOSS_PERSONAS[player.bossType || ''] || DEFAULT_PERSONA;
  const personaText = registryPersonality?.trim() || `${fallbackPersona.style} / ${fallbackPersona.signature}`;

  const comesAgain = encounterCount >= 1;
  const crossGameContext = formatCrossGameContext(crossGameHistory);
  const triggerType = player.triggerType || 'normal';
  const percentText = typeof player.percent === 'number' && Number.isFinite(player.percent)
    ? `${player.percent.toFixed(1).replace(/\.0$/, '')}%`
    : '정보없음';

  const isLinerush = (player.gameId || 'enhance') === 'linerush';
  const isBlockblast = (player.gameId || 'enhance') === 'blockblast';
  const situationLine = isBlockblast
    ? `상황: 블록퍼즐 Lv.${player.stage || '?'}, 보드 ${percentText} 채워짐, 콤보최고 x${player.playerLevel || '?'}, 점수:${player.score || 0}`
    : isLinerush
    ? `상황: 땅따먹기 스테이지${player.stage || '?'}, 영역 ${percentText} 점령됨, 목숨${player.playerLevel || '?'}`
    : `상황: ${player.playerWeapon || '무기없음'} +${player.playerLevel} ${player.playerGrade}, 속성:${player.playerElement || '무'}, 골드:${player.playerGold}G`;

  const prompt = `RPG 보스 "${player.bossName}"(티어${player.bossTier || '?'}) 역할극. ${encounterCount + 1}번째 조우.
${situationLine}
게임:${player.gameId || 'enhance'}, 트리거:${triggerType}, 점유율:${percentText}
${history.length > 0 ? '최근내역: ' + history.slice(-3).map(h => `+${h.player_level} [${h.boss_action}]`).join('→') : '첫만남'}
${isLinerush ? '' : `약점:${bossWeaknesses.join(',') || '없음'} ${playerHasAdvantage ? '[플레이어 속성유리]' : ''} ${playerHasDisadvantage ? '[보스 속성유리]' : ''}`}

페르소나: ${personaText}

${crossGameContext}

=== 대사 스타일 (핵심!) ===
\${isBlockblast ? \`이 보스는 "블록 마스터"로, 퍼즐의 신을 자처하는 까칠한 퍼즐 매니아. 플레이어의 배치를 실시간으로 비평함.
- 콤보 높으면 인정: "x\${player.playerLevel}콤보는 좀 치네", "오 좀 하는구나"
- 보드 많이 참: "보드 \${percentText}? 정리 좀 해ㅋㅋ", "곧 막히겠네 ㅋ"
- 점수 높으면 긴장: "\${player.score || 0}점? 잠깐 이거 레알?", "나보다 잘하는거 아니지?"
- 점수 낮으면 놀림: "이게 최선? ㅋㅋ", "초보세요?"
- action: scramble(행섞기)|freeze(조작금지2.5초)|bomb(4x4파괴)|taunt(도발만)
- emotion: amused|bored|scared|excited\` : \`이 보스는 맨날 사냥당하는 처지라 피로감이 극심함.\`} 뻔한 악당 대사(크큭/감히/멸망/두려워하라) 완전 금지.
대신 이런 느낌으로:
- 귀찮아/지침: 피로함, 짜증, 체념 느낌. 구체적 문장은 매번 다르게 창작할 것.
- 협박 대신 흥정: "나말고 딴 보스 때려 돈줄게", "그냥 가면 골드 드림", "딜 하나 하자"
- 현실적 불평: "손가락 안 아프냐 진짜", "이게 직업이냐", "몇시간째 파밍이냐"
- 낮은강화 무시: "+${player.playerLevel}강이 감히? ㅋ", "장난치냐", "그거 가지고 왔어?"
- 높은강화 당황: "+${player.playerLevel}이라고? 잠깐만", "야 그 무기 사기 아님?", "진심임?"
- 돈 많으면 비꼬기: "${Math.floor(player.playerGold / 10000)}만골드 있으면서 왜 나한테 옴"
- 한국어 인터넷 반말 허용: ㅋㅋ, ㅜㅜ, 진짜로?, 레알?, 어이없어, 씁, 하
${comesAgain ? '- 재방문 피로: "형이라 부를게 제발 그만와", "또 왔냐 진짜"' : ''}
${triggerType === 'greeting' ? '- greeting 상황: 시작 멘트 느낌으로, 전투 선언은 짧게.' : ''}
${triggerType === 'desperate' ? '- desperate 상황: 플레이어가 절박함. 이를 비꼬거나 압박하는 톤 강화.' : ''}

=== 대사 예시 (이런 느낌으로, 그대로 쓰지 말것!) ===
"야 ${player.playerLevel}강 들고 왔어 진짜?"
"아 또야... 딴데 좀 가 진심"
"오늘 몇번째냐 출근이냐"
"그 무기 리콜 안 됐어?"
"나 오늘 컨디션 안 좋은데"
"아니 ${Math.floor(player.playerGold / 10000)}만골 있잖아 뽑기를 해"
"...할말 없다 그냥 와"
"ㅋㅋ 긴장됨? 안 돼 ㅋ"
"차라리 낚시게임 해"

글자 수: 한국어 10~30자. 짧고 찰지게. 매번 완전히 다른 문장 창작할 것!

규칙:
- +0강이면 반드시 action:gift, goldGift:10000 (불쌍해서 줌)
- action: ${isBlockblast ? 'scramble|freeze|bomb|taunt' : 'normal_attack|special_skill|taunt|gift|flee'}
- emotion: angry|amused|scared|bored|excited

JSON만 출력: {"dialogue":"대사","action":"normal_attack","emotion":"amused"}`;

  // Primary: llm.cocy.io (admin config 기반 모델)
  const modelConfig = await getModelConfig('game-boss');
  let text = '';
  try {
    const llmResp = await fetch('https://llm.cocy.io/v2/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmSecret}` },
      body: JSON.stringify({ model: modelConfig.primary, messages: [{ role: 'system', content: prompt }] }),
    });
    if (llmResp.ok) {
      const llmData = await llmResp.json() as any;
      text = llmData?.choices?.[0]?.message?.content || '';
    }
  } catch (_) {}

  // Fallback: Gemini
  if (!text) {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.2, maxOutputTokens: 1024 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const data = await response.json() as any;
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
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
  } catch {
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

interface CrossGameAggRow {
  game_id: string;
  result: string;
  cnt: number | string;
}

interface CrossGameLatestRow {
  game_id: string;
  result: string;
  created_at: string;
}

function formatCrossGameContext(summary: CrossGameHistorySummary): string {
  if (!summary.totalEncounters) {
    return '[크로스게임 기록]\n이 플레이어와 첫 만남';
  }

  const byGameLines = summary.byGame.map((game) => {
    const resultText = Object.entries(game.results)
      .sort((a, b) => b[1] - a[1])
      .map(([result, count]) => `${result} ${count}`)
      .join(', ');
    return `- ${game.gameId}에서 ${game.total}번${resultText ? ` (${resultText})` : ''}`;
  });

  const latestText = summary.latest
    ? `${summary.latest.gameId}에서 ${summary.latest.result} (${formatElapsed(summary.latest.createdAt)})`
    : '기록 없음';

  return `[크로스게임 기록]\n이 플레이어와 총 ${summary.totalEncounters}번 만남:\n${byGameLines.join('\n')}\n가장 최근: ${latestText}`;
}

function formatElapsed(createdAt: string): string {
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return '방금 전';

  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}초 전`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

async function getBossPersonality(db: D1Database, bossId: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT personality FROM bosses WHERE boss_id = ?').bind(bossId).first<{ personality: string }>();
    return row?.personality || null;
  } catch {
    return null;
  }
}

async function getCrossGameHistory(db: D1Database, playerId: string, bossId: string): Promise<CrossGameHistorySummary> {
  try {
    const { results } = await db.prepare(
      `SELECT game_id, result, COUNT(*) as cnt
       FROM boss_player_history
       WHERE player_id = ? AND boss_id = ?
       GROUP BY game_id, result`
    ).bind(playerId, bossId).all<CrossGameAggRow>();

    const latest = await db.prepare(
      `SELECT game_id, result, created_at
       FROM boss_player_history
       WHERE player_id = ? AND boss_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(playerId, bossId).first<CrossGameLatestRow>();

    const gameMap = new Map<string, { total: number; results: Record<string, number> }>();
    for (const row of results || []) {
      const gameId = row.game_id || 'unknown';
      const result = row.result || 'unknown';
      const count = Number(row.cnt) || 0;
      const game = gameMap.get(gameId) || { total: 0, results: {} };
      game.total += count;
      game.results[result] = (game.results[result] || 0) + count;
      gameMap.set(gameId, game);
    }

    const byGame = Array.from(gameMap.entries())
      .map(([gameId, data]) => ({ gameId, total: data.total, results: data.results }))
      .sort((a, b) => b.total - a.total);

    const totalEncounters = byGame.reduce((sum, game) => sum + game.total, 0);

    return {
      totalEncounters,
      byGame,
      latest: latest
        ? {
          gameId: latest.game_id,
          result: latest.result,
          createdAt: latest.created_at,
        }
        : null,
    };
  } catch {
    return { totalEncounters: 0, byGame: [], latest: null };
  }
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

async function saveBossPlayerHistory(
  db: D1Database,
  playerId: string,
  bossId: string,
  gameId: string,
  stage: number | null,
  score: number | null,
) {
  try {
    await db.prepare(
      `INSERT INTO boss_player_history (player_id, boss_id, game_id, result, stage, score)
       VALUES (?, ?, ?, 'talked', ?, ?)`
    ).bind(playerId, bossId, gameId, stage, score).run();
  } catch (e) {
    console.error('Failed to save boss_player_history:', e);
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
