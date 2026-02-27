-- Boss Registry: 크로스게임 보스 정체성
CREATE TABLE IF NOT EXISTS bosses (
    boss_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,
    personality TEXT NOT NULL,       -- LLM 프롬프트용 성격 설명
    origin_game TEXT NOT NULL,       -- 처음 등장한 게임
    appearance TEXT,                 -- 외형 설명 (이미지 생성용)
    color INTEGER,                   -- 테마 컬러 (hex)
    tier INTEGER DEFAULT 1,          -- 1=일반, 2=중간, 3=보스, 4=숨겨진
    catchphrase TEXT,                -- 대표 대사
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Cross-game boss-player history (확장된 boss_encounters)
CREATE TABLE IF NOT EXISTS boss_player_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    boss_id TEXT NOT NULL,
    game_id TEXT NOT NULL,            -- linerush, weaponup, defense, ...
    result TEXT NOT NULL,             -- killed, escaped, lost, talked
    stage INTEGER,
    score INTEGER,
    detail TEXT,                      -- JSON: 추가 컨텍스트
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (boss_id) REFERENCES bosses(boss_id)
);
CREATE INDEX IF NOT EXISTS idx_bph_player ON boss_player_history(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bph_boss ON boss_player_history(boss_id, player_id);

-- Shared Weapons: 무기강화 무기 → 다른 게임에서 사용
CREATE TABLE IF NOT EXISTS player_weapons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    weapon_name TEXT NOT NULL,
    weapon_type TEXT,                 -- sword, axe, bow, staff, ...
    element TEXT,                     -- fire, ice, lightning, dark, holy, ...
    level INTEGER DEFAULT 0,          -- 강화 레벨
    attack INTEGER DEFAULT 10,
    special TEXT,                     -- 특수 효과 설명
    is_main INTEGER DEFAULT 0,        -- 메인 장비 여부
    origin_game TEXT DEFAULT 'weaponup',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pw_player ON player_weapons(player_id, is_main DESC);

-- Insert default bosses
INSERT OR IGNORE INTO bosses (boss_id, name, name_en, personality, origin_game, tier, catchphrase, color) VALUES
('slime', '슬라임', 'Slime', '느긋하고 반말. 귀찮아하지만 은근 승부욕 있음. 말투가 늘어짐.', 'linerush', 1, '으... 또 왔어...?', 0x44ff44),
('spin', '스핀', 'Spin', '활발하고 도발적. 빠른 말투. 자기가 제일 빠르다고 자부.', 'linerush', 1, '나한테 잡힐 줄 알고?', 0xffaa22),
('tentacle', '촉수', 'Tentacle', '음침하고 지적임. 존댓말 사용. 함정을 좋아함.', 'linerush', 2, '...흥미롭군요.', 0xcc44ff),
('eyeball', '아이볼', 'Eyeball', '호기심 많고 관찰자. 플레이어의 패턴을 언급함.', 'linerush', 2, '너의 움직임... 다 보여.', 0xff2244),
('ice', '아이스', 'Ice', '차갑고 과묵. 짧은 문장. 감정 없는 듯하지만 질 때 분노.', 'linerush', 2, '...얼어붙어라.', 0x88ddff),
('flame', '플레임', 'Flame', '열정적이고 시끄러움. 감탄사 많음. 화나면 더 강해짐.', 'linerush', 3, '불태워주마!!', 0xff6600),
('thunder', '썬더', 'Thunder', '자신감 넘치고 과장됨. 왕처럼 말함. 실수하면 당황.', 'linerush', 3, '번개의 심판을 받아라!', 0xffff22),
('dark', '다크', 'Dark', '철학적이고 우울. 존재의 의미를 물음. 은근 약함.', 'linerush', 3, '...어둠 속에서 답을 찾아.', 0xaa44ff),
('chaos', '카오스', 'Chaos', '예측불가. 말이 중간에 바뀜. 랜덤한 행동. 웃음이 많음.', 'linerush', 4, '아하하! 뭐가 될까~?', 0xff44aa),
('void', '보이드', 'Void', '위압적. 존댓말이지만 공포를 줌. 최종보스 포스. 플레이어를 인정하면 태도 변화.', 'linerush', 4, '...끝입니다.', 0xff0000),
('dragon', '불의군주', 'Fire Lord', '피로한 중년 보스. 출퇴근하듯 싸움. 크큭 금지. 현실적 푸념.', 'weaponup', 4, '오늘도 야근이냐...', 0xff4400);
