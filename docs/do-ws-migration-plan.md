# DO + WebSocket 마이그레이션 계획서 — relay.cocy.io

> 작성 2026-06-15. 목적: D1 1초 폴링 전송 → **방당 Durable Object + WebSocket**.
> **게임 로직(`applyAction`)과 게임 클라이언트는 그대로 두고, 전송 계층만 교체한다.**

## 0. 한 줄 요약

지금 불안정의 원인은 게임 로직이 아니라 **전송 substrate**다. 상태 없는 Pages Functions가 지속 연결을 못 들어서, D1을 실시간 버스로 **1초마다 폴링(쓰기 위주)** 하고 있다. 4명도 빡세고 10명이면 write 경합으로 붕괴한다. → 방 하나를 **Durable Object(메모리 상태) + WebSocket(즉시 브로드캐스트)** 로 옮긴다. 폴링 0, presence write 0, server-authoritative 유지, 무료티어 내.

## 1. 현 구조의 문제 (확인된 사실)

- 클라는 SSE(`/stream`) 우선, 실패 시 **1초 폴링**(`/events`) + presence 핑 5초.
- `stream.ts`의 SSE는 **가짜 실시간** — Pages Function 안 `setInterval(1000)`으로 **서버가 D1을 1초 폴링**.
- 매 라운드가 **쓰기**: `touchPlayerPresence`(UPDATE) + `markStalePlayers`(UPDATE) + events SELECT.
- 4명 ≈ 초당 ~8 write/방, 10명 ≈ ~20 write/방. 전 게임이 **D1 하나 공유**(사실상 단일 writer) → 방끼리도 경합.
- Pages Function은 장수 연결에 안 맞아 SSE 루프가 evict → 폴링 폴백 → 호출 폭증.

## 2. 재사용 경계 — 무엇을 **안** 건드리나 (핵심)

| 유지 (자산) | 교체 |
|---|---|
| **GamePlugin 전부 (13개)** — `applyAction(state, action, userId) → { newState, events }` 순수 리듀서. 전송 무관, 100% 재사용 | 전송: `events`/`stream`/`presence` 폴링 → DO + WS 브로드캐스트 |
| **게임 클라이언트들** (poker/mahjong/gostop/...) — `lib/multiplayer.js` 뒤에 숨음 | `multiplayer.js` **내부** (SSE/폴링 → WS). **공개 메서드·콜백(`onEvent`/`onStateChange`/`onError`/`onRoomDestroyed`/`onReconnected`) 시그니처 유지 → 게임 코드 0 수정** |
| **D1** — 랭킹·전적·방 스냅샷(재접속 복원용) | D1의 **실시간 핫패스 역할**(events 폴링·presence write) 제거 |
| registry / 인증 / matchmaking 개념 | room manager가 roomId → DO 라우팅으로 |

핵심: **게임 두뇌(`applyAction`) + 게임 클라는 그대로.** 갈아끼우는 건 "방 상태를 어디에 들고, 누구에게 어떻게 전파하나"뿐.

## 3. 타깃 아키텍처

```
클라 ──wss──> Worker(엔트리) ──roomId 라우팅──> RoomDO (Durable Object, SQLite 백엔드)
                                                  ├─ state (메모리)
                                                  ├─ 접속 소켓 Set
                                                  ├─ seq 카운터
                                                  └─ applyAction(plugin) 호출 → broadcast
```

- **방 1개 = DO 1개** (DO id = roomId). 한 방의 모든 트래픽이 한 인스턴스로 모여 강한 일관성 + 인메모리 상태.
- action 흐름: 소켓으로 action 도착 → `getGame(gameType).applyAction(state, action, userId)` → `newState` 메모리 갱신 + `events`를 **접속 전원에 즉시 broadcast** → (스로틀) DO storage에 스냅샷.
- **Hibernatable WebSocket**: 메시지 없으면 잠듦(연결 유지, duration 청구 0).
- **presence**: 소켓 연결/해제로 DO가 즉시 인지 → 별도 D1 write 불필요.
- **재접속**: DO 살아있으면 즉시 현재 state 전송; evict됐으면 DO storage(또는 D1) 스냅샷에서 복원. 기존 `lastSeq` 재동기 개념 재사용.
- **AI 좌석(`ai-`)**: DO가 `applyAction` 루프 그대로 처리(현 action.ts 로직 이식).

## 4. 단계 — PoC 먼저, 점진 이관, 항상 롤백 가능

### Phase 0 — PoC (게임 1개, 완전 격리)
- 가장 단순한 게임(echo 또는 connect4/gomoku)을 **RoomDO + WS**로 신규 Worker에 구현. 기존 relay는 **그대로 둠**(신규 경로만 추가, 예: 별도 워커/서브도메인).
- **부하 실측**: 4명 → 10명 동시 접속, 메시지 왕복 지연·연결 안정성·DO duration(GB-s) 측정.
- **Done 기준**: 10명이 안정적으로 도는 실측 수치 확보.

### Phase 1 — 전송 추상화 + 클라 스위치
- `multiplayer.js`에 **WS 트랜스포트** 추가, 공개 API 유지. **feature flag**(게임별/방별)로 v2(WS) on/off.
- 한 게임을 flag로 v2 전환 → 프로덕션 소수 사용자 검증.

### Phase 2 — 게임 점진 이관
- 각 게임의 `applyAction`을 RoomDO가 import해서 호출. 게임 하나씩 flag on. **문제 시 flag off → 기존 폴링 경로로 즉시 롤백**(이 단계까지 구 경로 살려둠).

### Phase 3 — 정리
- 전 게임 이관·안정 확인 후 `events` 폴링 / `stream` / presence-write 경로 제거. D1은 랭킹·전적·스냅샷만.

## 5. 리스크 & 가드

- **DO evict 시 메모리 손실** → 매 action 후(또는 N action마다) DO storage 스냅샷 + 복원 경로 필수.
- **WS 끊김/재접속** → seq 기반 재동기(`lastSeq`) 재사용.
- **무료티어 한도** (100k req/day, 13k GB-s/day) → Phase 0에서 실측해 여유 확인. 초과는 **과금이 아니라 에러**(폭탄요금 없음).
- **롤백 안전망**: Phase 2까지 기존 폴링 경로 유지 → flag off면 즉시 원복.

## 6. 무료티어 비용 (Cloudflare 공식, 2026-04 기준)

- DO **SQLite 백엔드** = Workers **Free 플랜** 사용 가능.
- WS 연결 1개 = 요청 1, 수신 메시지 20개 = 1요청, **송신 브로드캐스트·핑 무료**, Hibernate 시 idle duration 0.
- 방당 소프트캡 ~1,000 req/s. → 동시 게임 몇 개 규모는 무료로 덮임. 커지면 $5/월 Workers Paid로 한도 대폭 상향.

## 7. 산출물 & 다음 결정 지점

- **Phase 0 산출물**: `RoomDO` PoC + 부하 실측 수치 1장(4명/10명 지연·안정성·duration).
- 그 수치를 보고 Phase 1 진행 여부 결정. (수치가 안 나오면 대안 B = Colyseus on VPS 재검토.)

## 부록 — 검토한 대안

- **WebRTC (CF 시그널링만)**: 기각. 턴제·server-authoritative에 안 맞음(P2P는 권위 모델 폐기 + 호스트 마이그레이션, 또는 서버 노드가 WebRTC 스택을 말해야 해 복잡도 폭증). TURN 폴백은 대역폭 과금. 지연이 병목이 아닌 우리 게임엔 손해.
- **Colyseus / ws on VPS** (Oracle Always-Free / Hetzner ~€4): DO와 동일 원리(상태풀 프로세스 + WS). 게임서버 프레임워크가 풍부하지만 가동·업타임을 직접 책임. CF 스택 이탈 시 폴백안으로 보관.
- **매니지드(Ably/Pusher)**: 무료티어 연결·메시지 캡 + 벤더 종속. 오버킬.
