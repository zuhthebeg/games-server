# 🎮 Multiplayer Game Relay Server

> Cloudflare Pages + D1 기반 턴제 보드게임 멀티플레이 중계 서버

## 개요

**목표:** 게임 로직과 분리된 확장 가능한 멀티플레이 중계 서버
- 새 게임 추가 시 백엔드 수정 최소화
- Cloudflare 무료 티어로 운영
- 턴제 게임 최적화 (SSE + Polling)

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                              │
│              (game.cocy.io/poker, /uno, etc.)               │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP/SSE
┌─────────────────────▼───────────────────────────────────────┐
│                   Relay Server API                           │
│                 (relay.cocy.io/api/*)                        │
├─────────────────────────────────────────────────────────────┤
│  Auth      │  Room Manager  │  Event Router  │  Matchmaker  │
├─────────────────────────────────────────────────────────────┤
│                     Game Plugins                             │
│              poker.ts │ uno.ts │ chess.ts │ ...             │
├─────────────────────────────────────────────────────────────┤
│                    Cloudflare D1                             │
│            users │ rooms │ players │ events                  │
└─────────────────────────────────────────────────────────────┘
```

## API 설계

### 인증 (Auth)

```
POST /api/auth/anonymous     익명 세션 생성 → { token, tempId }
POST /api/auth/register      닉네임 등록 → { token, userId }
GET  /api/auth/me            현재 사용자 정보
```

### 방 관리 (Rooms)

```
POST   /api/rooms                    방 생성
GET    /api/rooms/:id                방 상태 조회
POST   /api/rooms/:id/join           입장
POST   /api/rooms/:id/leave          퇴장
POST   /api/rooms/:id/ready          준비 완료
POST   /api/rooms/:id/start          게임 시작 (방장)
DELETE /api/rooms/:id                방 삭제 (방장)
```

### 게임 액션 (Actions)

```
POST   /api/rooms/:id/action         게임 액션 전송
GET    /api/rooms/:id/state          현재 게임 상태
GET    /api/rooms/:id/events?after=  이벤트 폴링
GET    /api/rooms/:id/stream         SSE 실시간 스트림
```

### 매칭 (Matchmaking)

```
POST   /api/match/join               랜덤 매칭 대기열 참가
DELETE /api/match/leave              대기열 이탈
GET    /api/match/status             매칭 상태 확인
```

## 데이터베이스 스키마

```sql
-- 사용자 (익명/등록 모두 지원)
CREATE TABLE users (
    id TEXT PRIMARY KEY,           -- uuid
    nickname TEXT,                  -- 닉네임 (null이면 익명)
    is_anonymous INTEGER DEFAULT 1, -- 1: 익명, 0: 등록
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT
);

-- 방
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,           -- 6자리 코드 (ABC123)
    game_type TEXT NOT NULL,       -- "poker", "uno", etc.
    status TEXT DEFAULT 'waiting', -- waiting, playing, finished
    host_id TEXT NOT NULL,         -- 방장
    config TEXT,                   -- JSON: 게임 설정
    state TEXT,                    -- JSON: 게임 상태 (플러그인이 관리)
    max_players INTEGER DEFAULT 4,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (host_id) REFERENCES users(id)
);

-- 방 참가자
CREATE TABLE room_players (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seat INTEGER,                  -- 자리 번호 (0, 1, 2, ...)
    is_ready INTEGER DEFAULT 0,
    player_state TEXT,             -- JSON: 플레이어별 상태 (손패 등)
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 게임 이벤트 로그 (실시간 동기화용)
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    seq INTEGER NOT NULL,          -- 방 내 순서 번호
    event_type TEXT NOT NULL,      -- "action", "join", "leave", "chat", etc.
    user_id TEXT,
    payload TEXT,                  -- JSON
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE INDEX idx_events_room_seq ON events(room_id, seq);

-- 매칭 대기열
CREATE TABLE match_queue (
    user_id TEXT PRIMARY KEY,
    game_type TEXT NOT NULL,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## 게임 플러그인 인터페이스

```typescript
// functions/games/types.ts

export interface Player {
    id: string;
    nickname: string;
    seat: number;
}

export interface GameAction {
    type: string;           // 게임별 액션 타입
    payload: any;           // 액션 데이터
}

export interface GameResult {
    winnerId?: string;      // 승자 (없으면 무승부)
    scores?: Record<string, number>;
    reason?: string;
}

export interface GamePlugin {
    // 메타데이터
    id: string;             // "poker", "uno", etc.
    name: string;           // "텍사스 홀덤"
    minPlayers: number;     // 최소 인원
    maxPlayers: number;     // 최대 인원
    
    // 라이프사이클
    createInitialState(players: Player[], config?: any): any;
    
    // 액션 처리
    validateAction(state: any, action: GameAction, playerId: string): { valid: boolean; error?: string };
    applyAction(state: any, action: GameAction, playerId: string): { newState: any; events: GameEvent[] };
    
    // 상태 확인
    getCurrentTurn(state: any): string | null;  // 현재 턴 플레이어
    isGameOver(state: any): boolean;
    getResult(state: any): GameResult | null;
    
    // 뷰 (클라이언트에 보여줄 상태)
    getPublicState(state: any): any;                           // 모든 플레이어에게 공개
    getPlayerView(state: any, playerId: string): any;          // 특정 플레이어 시점
}
```

### 예시: 포커 플러그인

```typescript
// functions/games/poker.ts

import { GamePlugin, Player, GameAction } from './types';

export const pokerPlugin: GamePlugin = {
    id: 'poker',
    name: '텍사스 홀덤',
    minPlayers: 2,
    maxPlayers: 8,
    
    createInitialState(players, config) {
        return {
            phase: 'preflop',
            pot: 0,
            communityCards: [],
            currentBet: 0,
            currentTurn: 0,
            players: players.map((p, i) => ({
                id: p.id,
                seat: i,
                chips: config?.startingChips || 1000,
                hand: [],         // 서버만 알고 있음
                bet: 0,
                folded: false,
            })),
            deck: shuffleDeck(),
        };
    },
    
    validateAction(state, action, playerId) {
        const player = state.players.find(p => p.id === playerId);
        if (!player) return { valid: false, error: 'Player not found' };
        if (state.players[state.currentTurn].id !== playerId) {
            return { valid: false, error: 'Not your turn' };
        }
        // ... 액션별 검증
        return { valid: true };
    },
    
    applyAction(state, action, playerId) {
        // ... 액션 적용 로직
        return { newState: state, events: [] };
    },
    
    getCurrentTurn(state) {
        return state.players[state.currentTurn]?.id || null;
    },
    
    isGameOver(state) {
        return state.players.filter(p => !p.folded && p.chips > 0).length <= 1;
    },
    
    getResult(state) {
        const winner = state.players.find(p => !p.folded && p.chips > 0);
        return winner ? { winnerId: winner.id } : null;
    },
    
    getPublicState(state) {
        return {
            phase: state.phase,
            pot: state.pot,
            communityCards: state.communityCards,
            currentBet: state.currentBet,
            currentTurn: state.currentTurn,
            players: state.players.map(p => ({
                id: p.id,
                seat: p.seat,
                chips: p.chips,
                bet: p.bet,
                folded: p.folded,
                // hand는 숨김!
            })),
        };
    },
    
    getPlayerView(state, playerId) {
        const publicState = this.getPublicState(state);
        const player = state.players.find(p => p.id === playerId);
        return {
            ...publicState,
            myHand: player?.hand || [],
        };
    },
};
```

## 프로젝트 구조

```
games-server/
├── functions/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── anonymous.ts    # POST 익명 세션
│   │   │   ├── register.ts     # POST 닉네임 등록
│   │   │   └── me.ts           # GET 내 정보
│   │   ├── rooms/
│   │   │   ├── index.ts        # POST 생성, GET 목록
│   │   │   └── [id]/
│   │   │       ├── index.ts    # GET 방 상태
│   │   │       ├── join.ts     # POST 입장
│   │   │       ├── leave.ts    # POST 퇴장
│   │   │       ├── ready.ts    # POST 준비
│   │   │       ├── start.ts    # POST 시작
│   │   │       ├── action.ts   # POST 액션
│   │   │       ├── events.ts   # GET 이벤트 폴링
│   │   │       └── stream.ts   # GET SSE
│   │   └── match/
│   │       ├── join.ts         # POST 대기열 참가
│   │       ├── leave.ts        # DELETE 이탈
│   │       └── status.ts       # GET 상태
│   ├── games/
│   │   ├── types.ts            # 플러그인 인터페이스
│   │   ├── registry.ts         # 게임 등록소
│   │   ├── poker.ts            # 포커
│   │   └── uno.ts              # 우노 (예시)
│   ├── lib/
│   │   ├── auth.ts             # 토큰 처리
│   │   ├── room-manager.ts     # 방 관리 유틸
│   │   └── matchmaker.ts       # 매칭 로직
│   ├── types.ts                # Env, 공통 타입
│   └── _middleware.ts          # CORS
├── schema.sql
├── wrangler.toml
├── package.json
└── README.md
```

## 통신 흐름

### 1. 방 생성 & 입장

```
Client A                    Server                    Client B
    │                          │                          │
    ├─POST /rooms─────────────►│                          │
    │  {game: "poker"}         │                          │
    │◄─{roomId: "ABC123"}──────│                          │
    │                          │                          │
    │                          │◄─POST /rooms/ABC123/join─┤
    │                          │  {token}                 │
    │                          ├─{success}───────────────►│
    │                          │                          │
    ├─GET /rooms/ABC123/stream─►│◄─GET /stream────────────┤
    │   (SSE connected)        │   (SSE connected)        │
    │◄─event: player_joined────│─event: player_joined───►│
```

### 2. 게임 진행

```
Client A                    Server                    Client B
    │                          │                          │
    ├─POST /action────────────►│                          │
    │  {type:"bet", amount:50} │                          │
    │                          │ validate → apply         │
    │◄─event: action──────────┤─event: action───────────►│
    │  {public state}          │  {public state}          │
    │◄─event: your_turn────────│                          │
    │  {private: myHand}       │                          │
```

## 클라이언트 SDK (선택)

```typescript
// 게임 클라이언트에서 사용할 간단한 SDK
class GameClient {
    private token: string;
    private roomId: string;
    private eventSource: EventSource;
    
    async createRoom(gameType: string): Promise<string>;
    async joinRoom(roomId: string): Promise<void>;
    async ready(): Promise<void>;
    async sendAction(action: GameAction): Promise<void>;
    
    onEvent(callback: (event: GameEvent) => void): void;
    onStateChange(callback: (state: any) => void): void;
}
```

## 배포

```bash
# 1. D1 생성
npx wrangler d1 create games-relay-db

# 2. wrangler.toml 설정

# 3. 스키마 적용
npx wrangler d1 execute games-relay-db --file=./schema.sql

# 4. 배포
npx wrangler pages deploy ./dist
```

## 확장 계획

### Phase 1 (현재)
- [x] 설계 완료
- [ ] 기본 API 구현
- [ ] 포커 플러그인
- [ ] SSE 실시간

### Phase 2
- [ ] 랜덤 매칭
- [ ] 우노 플러그인
- [ ] 채팅 기능

### Phase 3
- [ ] 관전 모드
- [ ] 게임 기록/리플레이
- [ ] Durable Objects 업그레이드 (필요시)

## 참고

- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- glovely, travel 레포 패턴 참고
