-- Multiplayer Game Relay Server Schema
-- Cloudflare D1 (SQLite)

-- 사용자 (익명/등록 모두 지원)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT,
    is_anonymous INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT
);

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
