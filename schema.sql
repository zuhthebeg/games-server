-- Multiplayer Game Relay Server Schema
-- Cloudflare D1 (SQLite)

-- 사용자 (익명/등록 모두 지원)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT,
    is_anonymous INTEGER DEFAULT 1,
    
    -- 이메일 인증
    email TEXT UNIQUE,
    password_hash TEXT,
    email_verified INTEGER DEFAULT 0,
    
    -- OAuth
    google_id TEXT UNIQUE,
    
    -- 프로필
    avatar_url TEXT,
    
    -- 타임스탬프
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id);

-- 이메일 인증 토큰
CREATE TABLE IF NOT EXISTS email_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'verify' | 'reset'
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);

-- 리프레시 토큰
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 이메일 발송 추적 (월 3000통 제한)
CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    type TEXT NOT NULL,
    sent_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_log_month ON email_log(sent_at);

-- 방
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    game_type TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    host_id TEXT NOT NULL,
    config TEXT,
    state TEXT,
    max_players INTEGER DEFAULT 4,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (host_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_game_type ON rooms(game_type, status);

-- 방 참가자
CREATE TABLE IF NOT EXISTS room_players (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seat INTEGER,
    is_ready INTEGER DEFAULT 0,
    player_state TEXT,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 게임 이벤트 로그
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    user_id TEXT,
    payload TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq);

-- 매칭 대기열
CREATE TABLE IF NOT EXISTS match_queue (
    user_id TEXT PRIMARY KEY,
    game_type TEXT NOT NULL,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_match_queue_game ON match_queue(game_type, joined_at);

-- 유저별 공유 게임 데이터 (골드, 숙련도, 무기 등)
CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT PRIMARY KEY,
    gold INTEGER DEFAULT 0,
    data TEXT,  -- JSON: { weapon, mastery, stats, protectionScrolls 등 }
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 랭킹 데이터
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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rankings_weapon ON rankings(best_weapon_level DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_kills ON rankings(total_kills DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_pvp ON rankings(pvp_rating DESC);
