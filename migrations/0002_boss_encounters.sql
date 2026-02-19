-- 보스 조우 기록 테이블
CREATE TABLE IF NOT EXISTS boss_encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  boss_id TEXT NOT NULL,
  boss_name TEXT NOT NULL,
  boss_dialogue TEXT,
  boss_action TEXT,
  boss_emotion TEXT,
  player_level INTEGER DEFAULT 0,
  player_gold INTEGER DEFAULT 0,
  game_id TEXT DEFAULT 'enhance',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boss_encounters_player_boss ON boss_encounters(player_id, boss_id);
CREATE INDEX IF NOT EXISTS idx_boss_encounters_created ON boss_encounters(created_at);
