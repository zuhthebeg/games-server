/**
 * 랭킹 공통 유틸
 * - 점수 업데이트
 * - 정산 (상금 지급 + 명예의 전당 갱신)
 * - rank_type 설정
 */

export interface Env { DB: D1Database }

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const RANK_TYPES = ['weapon', 'hunt', 'pvp'] as const;
export type RankType = typeof RANK_TYPES[number];

/** KST 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

/** rank_daily 점수 UPSERT */
export async function upsertDailyScore(
  DB: D1Database, userId: string, rankType: RankType, score: number
) {
  const date = todayKST();
  await DB.prepare(`
    INSERT INTO rank_daily (user_id, rank_type, score, date, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, rank_type, date)
    DO UPDATE SET score = MAX(score, excluded.score), updated_at = datetime('now')
  `).bind(userId, rankType, score, date).run();
}

/** 정산: next_reset_at 지난 rank_type 처리 */
export async function settleIfDue(DB: D1Database): Promise<SettleResult[]> {
  const now = new Date().toISOString();
  const configs = await DB.prepare(
    `SELECT * FROM rank_configs WHERE enabled = 1 AND next_reset_at <= ?`
  ).bind(now).all<RankConfig>();

  const results: SettleResult[] = [];
  for (const cfg of (configs.results ?? [])) {
    const r = await settleRankType(DB, cfg);
    results.push(r);
  }
  return results;
}

/** 단일 rank_type 정산 — rankings 테이블(화면 기준)으로 직접 정산 */
async function settleRankType(DB: D1Database, cfg: RankConfig): Promise<SettleResult> {
  const periodDate = todayKST();

  // 화면에 보이는 랭킹과 동일한 기준으로 TOP N 조회
  const scoreCol =
    cfg.rank_type === 'weapon' ? 'best_weapon_level' :
    cfg.rank_type === 'hunt'   ? 'total_kills' :
    cfg.rank_type === 'pvp'    ? 'pvp_rating' : 'best_weapon_level';

  const topRows = await DB.prepare(`
    SELECT r.user_id, r.${scoreCol} as score
    FROM rankings r
    INNER JOIN users u ON r.user_id = u.id
    WHERE u.email IS NOT NULL AND r.${scoreCol} > 0
    ORDER BY r.${scoreCol} DESC
    LIMIT ?
  `).bind(cfg.top_n).all<{ user_id: string; score: number }>();

  const winners = topRows.results ?? [];
  const rewarded: { user_id: string; rank: number; score: number }[] = [];

  for (let i = 0; i < winners.length; i++) {
    const { user_id, score } = winners[i];
    const rank = i + 1;

    // 골드 지급 (user_data)
    await DB.prepare(`
      INSERT INTO user_data (user_id, gold, data, updated_at)
      VALUES (?, ?, '{}', datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET gold = gold + ?, updated_at = datetime('now')
    `).bind(user_id, cfg.gold_reward, cfg.gold_reward).run();

    // 상금 로그
    await DB.prepare(`
      INSERT INTO rank_reward_log (rank_type, user_id, rank, score, gold, period_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(cfg.rank_type, user_id, rank, score, cfg.gold_reward, periodDate).run();

    // 명예의 전당 갱신 (TOP 3만)
    if (rank <= 3) {
      await DB.prepare(`
        INSERT INTO hall_of_fame (rank_type, user_id, best_score, best_rank, best_date, total_wins, total_gold, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
        ON CONFLICT(rank_type, user_id) DO UPDATE SET
          best_score = CASE WHEN excluded.best_score > best_score THEN excluded.best_score ELSE best_score END,
          best_rank  = CASE WHEN excluded.best_score > best_score THEN excluded.best_rank ELSE best_rank END,
          best_date  = CASE WHEN excluded.best_score > best_score THEN excluded.best_date ELSE best_date END,
          total_wins = total_wins + 1,
          total_gold = total_gold + excluded.total_gold,
          updated_at = datetime('now')
      `).bind(cfg.rank_type, user_id, score, rank, periodDate, cfg.gold_reward).run();
    }

    rewarded.push({ user_id, rank, score });
  }

  // next_reset_at 갱신
  const nextReset = calcNextReset(cfg.period);
  await DB.prepare(`
    UPDATE rank_configs
    SET next_reset_at = ?, last_reset_at = datetime('now'), updated_at = datetime('now')
    WHERE rank_type = ?
  `).bind(nextReset, cfg.rank_type).run();

  // 시즌 기록 초기화 (정산 후 이번 시즌 활동 기록 리셋)
  if (cfg.rank_type === 'hunt') {
    // 사냥: total_kills, boss_kills, max_kill_streak 리셋
    await DB.prepare(`UPDATE rankings SET total_kills = 0, boss_kills = 0, max_kill_streak = 0, updated_at = datetime('now')`).run();
  } else if (cfg.rank_type === 'pvp') {
    // PvP: 승/패 리셋, 레이팅은 1000 기준으로 partial 리셋 (급락 방지)
    await DB.prepare(`UPDATE rankings SET pvp_wins = 0, pvp_losses = 0, pvp_rating = MAX(800, ROUND(pvp_rating * 0.8 + 1000 * 0.2)), updated_at = datetime('now')`).run();
  }
  // weapon은 best_weapon_level이 영구 기록이라 초기화 없음

  // 이전 rank_daily 데이터 정리 (30일 초과)
  await DB.prepare(`DELETE FROM rank_daily WHERE rank_type = ? AND date < date('now', '-30 days')`).bind(cfg.rank_type).run();

  return { rank_type: cfg.rank_type, rewarded };
}

function calcNextReset(period: string): string {
  const now = new Date();
  if (period === 'weekly') now.setDate(now.getDate() + 7);
  else if (period === 'monthly') now.setMonth(now.getMonth() + 1);
  else now.setDate(now.getDate() + 1); // daily
  // KST 00:00 = UTC 15:00
  const d = now.toISOString().slice(0, 10);
  return `${d}T15:00:00.000Z`;
}

interface RankConfig {
  rank_type: RankType;
  label: string;
  period: string;
  gold_reward: number;
  top_n: number;
  next_reset_at: string;
}

export interface SettleResult {
  rank_type: string;
  rewarded: { user_id: string; rank: number; score: number }[];
}
