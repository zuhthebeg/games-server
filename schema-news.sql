CREATE TABLE IF NOT EXISTS news_factcheck (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_url TEXT NOT NULL UNIQUE,
  article_title TEXT,
  summary TEXT,
  result_type TEXT NOT NULL,  -- 'factcheck' | 'review'
  score INTEGER,              -- factcheck일 때만
  reason TEXT,
  caution TEXT,
  evaluation TEXT,            -- review일 때만
  bias TEXT,
  headline_intent TEXT,       -- 정보전달|의제설정|클릭베이트|정치적|상업적
  headline_fair INTEGER,      -- 1=공정, 0=주의
  headline_note TEXT,
  journalist_name TEXT,
  journalist_media TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_journalists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  media TEXT,
  article_count INTEGER DEFAULT 1,
  avg_score REAL,             -- factcheck 기사들의 평균 신뢰도
  bias_summary TEXT,          -- 누적 편향성 요약
  quality_summary TEXT,       -- 품질 패턴 요약
  intent_counts TEXT,         -- JSON: {"정보전달":3,"클릭베이트":1,...}
  last_article_url TEXT,
  last_checked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, media)
);
