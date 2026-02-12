-- 랭킹 데이터 테이블
CREATE TABLE IF NOT EXISTS rankings (
    user_id TEXT PRIMARY KEY,
    -- 무기 랭킹
    best_weapon_level INTEGER DEFAULT 0,
    best_weapon_name TEXT,
    best_weapon_grade TEXT,
    best_weapon_element TEXT,
    best_weapon_achieved_at TEXT,
    -- 사냥 랭킹
    total_kills INTEGER DEFAULT 0,
    max_kill_streak INTEGER DEFAULT 0,
    -- PvP 랭킹
    pvp_wins INTEGER DEFAULT 0,
    pvp_losses INTEGER DEFAULT 0,
    pvp_rating INTEGER DEFAULT 1000,
    -- 메타
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rankings_weapon ON rankings(best_weapon_level DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_kills ON rankings(total_kills DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_pvp ON rankings(pvp_rating DESC);
