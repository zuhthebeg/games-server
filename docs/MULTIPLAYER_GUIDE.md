# 🎮 멀티플레이어 게임 통합 가이드

relay.cocy.io를 사용한 턴제 멀티플레이어 게임 구현 가이드

## 개요

이 시스템은 다음을 제공합니다:
- 익명/닉네임 인증
- 방 생성/참가/퇴장
- 랜덤 매칭
- 실시간 이벤트 (SSE + 폴링)
- 리매치 시스템

## 빠른 시작

### 1. 클라이언트 추가

```html
<script src="https://game.cocy.io/lib/multiplayer.js"></script>
```

또는 복사해서 사용:
```javascript
const RELAY_URL = 'https://relay.cocy.io';
// ... (multiplayer.js 내용)
```

### 2. 기본 사용법

```javascript
// 싱글톤 인스턴스 사용
const client = MultiplayerClient.getInstance();

// 인증
await client.ensureAuth();
await client.setNickname('플레이어1');

// 방 생성
const room = await client.createRoom({
    gameType: 'poker',      // 게임 종류
    isPublic: true,         // 랜덤 매칭 허용
    startingChips: 1000,    // 게임별 설정
});
console.log('방 코드:', room.roomId);

// 또는 방 참가
await client.joinRoom('ABC123');

// 또는 랜덤 매칭
await client.joinRandom('poker');
```

### 3. 실시간 이벤트 수신

```javascript
// 이벤트 핸들러 설정
client.onEvent = (type, data) => {
    console.log('이벤트:', type, data);
    // player_joined, player_left, player_ready, game_started, 
    // action, win, game_ended, rematch_ready 등
};

client.onStateChange = (state) => {
    console.log('상태 변경:', state);
    updateGameUI(state);
};

// 리스닝 시작
client.startListening();
```

### 4. 게임 액션 전송

```javascript
// 준비 완료
await client.setReady(true);

// 게임 시작 (방장만)
await client.startGame();

// 게임 액션
await client.sendAction({ type: 'fold' });
await client.sendAction({ type: 'raise', payload: { amount: 100 } });

// 리매치 요청
await client.rematch();
```

## API 레퍼런스

### MultiplayerClient

```javascript
class MultiplayerClient {
    // 싱글톤
    static getInstance(): MultiplayerClient
    static resetInstance(): void
    
    // 인증
    async ensureAuth(): Promise<boolean>
    async setNickname(name: string): Promise<User>
    clearAuth(): void
    
    // 방 관리
    async createRoom(config): Promise<{ roomId: string }>
    async joinRoom(roomId: string): Promise<void>
    async joinRandom(gameType: string): Promise<{ roomId: string }>
    async leaveRoom(): Promise<void>
    async getRoomState(): Promise<RoomState>
    
    // 게임
    async setReady(ready: boolean): Promise<void>
    async startGame(): Promise<void>
    async sendAction(action: GameAction): Promise<ActionResult>
    async rematch(): Promise<void>
    
    // 실시간
    startListening(): void
    stopListening(): void
    cleanup(): void
    
    // 유틸
    getRoomCode(): string
    getMyUserId(): string
    isInRoom(): boolean
}
```

### 이벤트 타입

| 이벤트 | 설명 | 페이로드 |
|--------|------|----------|
| `player_joined` | 플레이어 입장 | `{ seat }` |
| `player_left` | 플레이어 퇴장 | `{ seat }` |
| `player_ready` | 준비 상태 변경 | `{ ready }` |
| `game_started` | 게임 시작 | `{ playerCount }` |
| `action` | 게임 액션 | `{ action, events }` |
| `win` | 승리 | `{ amount, hand }` |
| `game_ended` | 게임 종료 | `{ result }` |
| `rematch_ready` | 리매치 요청 | `{}` |
| `host_changed` | 방장 변경 | `{}` |

### RoomState 구조

```typescript
interface RoomState {
    id: string;
    gameType: string;
    status: 'waiting' | 'playing' | 'finished';
    hostId: string;
    players: Array<{
        id: string;
        nickname: string;
        seat: number;
        isReady: boolean;
        isHost: boolean;
    }>;
    gameState?: any;      // 게임별 공개 상태
    myView?: any;         // 내 시점 (비공개 정보 포함)
}
```

## UI 패턴

### 1. 모드 선택

```html
<div class="mode-select">
    <button onclick="startSinglePlayer()">🤖 싱글플레이</button>
    <button onclick="showLobby()">👥 멀티플레이</button>
</div>
```

### 2. 로비

```html
<div class="lobby">
    <input id="nickname" placeholder="닉네임">
    <label>
        <input type="checkbox" id="publicRoom" checked>
        🌐 랜덤 참가 허용
    </label>
    <button onclick="createRoom()">방 만들기</button>
    
    <button onclick="joinRandom()">🎲 랜덤 매칭</button>
    <input id="roomCode" placeholder="방 코드">
    <button onclick="joinRoom()">참가</button>
</div>
```

### 3. 대기실

```html
<div class="waiting-room">
    <div class="room-code">ABC123</div>
    <img id="qrCode" src="...">  <!-- QR 코드 -->
    
    <div class="player-list">
        <!-- 플레이어 목록 -->
    </div>
    
    <button onclick="toggleReady()">준비</button>
    <button onclick="startGame()">게임 시작</button>  <!-- 방장만 -->
</div>
```

### 4. QR 코드 생성

```javascript
const joinUrl = `${location.origin}${location.pathname}?room=${roomCode}`;
const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(joinUrl)}`;
document.getElementById('qrCode').src = qrUrl;
```

### 5. URL 파라미터 처리

```javascript
// 페이지 로드 시
const params = new URLSearchParams(location.search);
const roomCode = params.get('room');
if (roomCode) {
    history.replaceState({}, '', location.pathname);
    showLobby();
    document.getElementById('roomCode').value = roomCode;
}
```

## 새 게임 추가하기

### 1. 서버 플러그인 작성

`games-server/functions/games/[게임명].ts`:

```typescript
import { GamePlugin } from './types';

export const myGamePlugin: GamePlugin = {
    id: 'mygame',
    name: '내 게임',
    minPlayers: 2,
    maxPlayers: 4,
    
    createInitialState(players, config) {
        return { /* 초기 상태 */ };
    },
    
    validateAction(state, action, playerId) {
        // 액션 검증
        return { valid: true };
    },
    
    applyAction(state, action, playerId) {
        // 액션 적용
        return { newState, events: [] };
    },
    
    getCurrentTurn(state) {
        return state.currentPlayerId;
    },
    
    isGameOver(state) {
        return state.finished;
    },
    
    getResult(state) {
        return { winnerId: state.winner };
    },
    
    getPublicState(state) {
        // 모두에게 공개되는 상태
        return { ... };
    },
    
    getPlayerView(state, playerId) {
        // 특정 플레이어에게 보이는 상태
        return { ...this.getPublicState(state), myCards: ... };
    },
};
```

### 2. 플러그인 등록

`games-server/functions/games/registry.ts`:

```typescript
import { myGamePlugin } from './mygame';
registerGame(myGamePlugin, { /* 기본 설정 */ });
```

### 3. 배포

```bash
cd games-server
git add -A && git commit -m "Add mygame"
git push
npx wrangler pages deploy ./dist --project-name=games-relay
```

## 팁

### 로딩 상태

```javascript
btn.classList.add('loading');
try {
    await someAction();
} finally {
    btn.classList.remove('loading');
}
```

```css
.btn.loading {
    pointer-events: none;
    opacity: 0.7;
}
.btn.loading::after {
    content: '';
    /* 스피너 애니메이션 */
}
```

### 에러 처리

```javascript
try {
    await client.joinRoom(code);
} catch (e) {
    if (e.message.includes('not found')) {
        alert('존재하지 않는 방입니다');
    } else if (e.message.includes('full')) {
        alert('방이 가득 찼습니다');
    } else {
        alert('오류: ' + e.message);
    }
}
```

### 토스트 메시지

```javascript
function showToast(msg, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}
```

## 예시 프로젝트

- **포커**: `game.cocy.io/poker/`
- 소스: `github.com/zuhthebeg/games/poker/`

## 서버 API

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/auth/anonymous` | POST | 익명 세션 |
| `/api/auth/register` | POST | 닉네임 등록 |
| `/api/auth/me` | GET | 내 정보 |
| `/api/rooms` | POST | 방 생성 |
| `/api/rooms/:id` | GET | 방 상태 |
| `/api/rooms/:id/join` | POST | 입장 |
| `/api/rooms/:id/leave` | POST | 퇴장 |
| `/api/rooms/:id/ready` | POST | 준비 |
| `/api/rooms/:id/start` | POST | 시작 |
| `/api/rooms/:id/action` | POST | 액션 |
| `/api/rooms/:id/rematch` | POST | 리매치 |
| `/api/rooms/:id/events` | GET | 이벤트 폴링 |
| `/api/rooms/:id/stream` | GET | SSE 스트림 |
| `/api/match/random` | POST | 랜덤 매칭 |
| `/api/games` | GET | 게임 목록 |
