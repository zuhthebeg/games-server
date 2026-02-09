# 🎮 Games Relay Server

멀티플레이 보드게임 중계 서버 (Cloudflare Pages + D1)

## 특징

- **게임 플러그인 시스템** - 새 게임 추가가 쉬움
- **실시간 동기화** - SSE 기반
- **무료 운영** - Cloudflare 무료 티어

## API

### 인증
- `POST /api/auth/anonymous` - 익명 세션
- `POST /api/auth/register` - 닉네임 등록
- `GET /api/auth/me` - 내 정보

### 방
- `POST /api/rooms` - 방 생성
- `GET /api/rooms/:id` - 방 상태
- `POST /api/rooms/:id/join` - 입장
- `POST /api/rooms/:id/leave` - 퇴장
- `POST /api/rooms/:id/ready` - 준비
- `POST /api/rooms/:id/start` - 시작
- `POST /api/rooms/:id/action` - 액션
- `GET /api/rooms/:id/events?after=` - 이벤트 폴링
- `GET /api/rooms/:id/stream?token=` - SSE

### 게임
- `GET /api/games` - 게임 목록

## 개발

```bash
npm install
npm run db:local      # 로컬 DB 초기화
npm run dev           # 로컬 서버
npm run deploy        # 배포
```

## 게임 추가

1. `functions/games/`에 플러그인 작성
2. `registry.ts`에서 등록
3. 끝!

## 라이선스

MIT
