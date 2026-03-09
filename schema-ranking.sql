-- 일일 활동 점수 (랭킹 기준, 날짜별 자동 구분)
CREATE TABLE IF NOT EXISTS rank_daily (
  user_id TEXT NOT NULL,
  rank_type TEXT NOT NULL,  -- 'weapon' | 'hunt' | 'pvp'
  score INTEGER DEFAULT 0,
  date TEXT NOT NULL,       -- YYYY-MM-DD (KST)
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, rank_type, date)
);

-- 명예의 전당 (시즌 우승 기록 영구 보존)
CREATE TABLE IF NOT EXISTS hall_of_fame (
  rank_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_rank INTEGER NOT NULL DEFAULT 1,
  best_date TEXT NOT NULL,        -- 최고기록 달성 날짜
  total_wins INTEGER DEFAULT 0,   -- 누적 TOP 10 횟수
  total_gold INTEGER DEFAULT 0,   -- 누적 획득 골드
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (rank_type, user_id)
);

-- 상금 지급 로그
CREATE TABLE IF NOT EXISTS rank_reward_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  period_date TEXT NOT NULL,  -- 정산 기준 날짜
  created_at TEXT DEFAULT (datetime('now'))
);

-- 랭킹 설정 (어드민에서 관리)
CREATE TABLE IF NOT EXISTS rank_configs (
  rank_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  period TEXT DEFAULT 'daily',      -- 'daily' | 'weekly' | 'monthly'
  gold_reward INTEGER DEFAULT 100000,
  top_n INTEGER DEFAULT 10,
  next_reset_at TEXT NOT NULL,      -- ISO8601 (UTC)
  last_reset_at TEXT,
  enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 기본 설정 삽입
INSERT OR IGNORE INTO rank_configs (rank_type, label, period, gold_reward, top_n, next_reset_at) VALUES
  ('weapon', '무기강화', 'daily', 100000, 10, datetime('now', '+1 day', 'start of day', '+15 hours')),
  ('hunt',   '사냥',    'daily', 100000, 10, datetime('now', '+1 day', 'start of day', '+15 hours')),
  ('pvp',    'PvP',    'daily', 100000, 10, datetime('now', '+1 day', 'start of day', '+15 hours'));
