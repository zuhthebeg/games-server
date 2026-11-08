CREATE TABLE IF NOT EXISTS devinarok_characters (
    user_id TEXT NOT NULL,
    char_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    level INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    gold INTEGER NOT NULL,
    debug_used INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_settlement_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, char_id)
);

CREATE TABLE IF NOT EXISTS devinarok_items (
    user_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    char_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    PRIMARY KEY (user_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_devinarok_items_character
    ON devinarok_items(user_id, char_id);

CREATE TABLE IF NOT EXISTS devinarok_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    char_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    idem_key TEXT,
    ops_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (char_id, idem_key)
);

CREATE INDEX IF NOT EXISTS idx_devinarok_ledger_user_created
    ON devinarok_ledger(user_id, created_at);
