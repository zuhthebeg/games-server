-- 유저별 공유 게임 데이터 (골드, 숙련도, 무기 등)
CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT PRIMARY KEY,
    gold INTEGER DEFAULT 0,
    data TEXT,  -- JSON: { weapon, mastery, stats, protectionScrolls 등 }
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
