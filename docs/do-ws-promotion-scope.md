# multiplayer.js 승격 — DO/WS 트랜스포트 스코프 (backlog 2번)

> 분류 청크 산출물 (2026-06-17, SLOW 게이트). 실제 코드는 GO 윈도우에서.
> 출처: `games/lib/multiplayer.js`(옛 REST/SSE) + `games/gostop/index.html` 인라인 WS(1227~1300).

## 핵심 발견 — 표면이 이미 호환된다

gostop 인라인 WS `client` 객체의 공개 메서드가 **옛 `MultiplayerClient`와 동일 시그니처**:

| 메서드 | 옛 REST(MultiplayerClient) | gostop WS(인라인) | 승격 후 공용 |
|---|---|---|---|
| `getMyUserId()` | ✅ | ✅ | 유지 |
| `onEvent` (콜백) | ✅ | ✅ | 유지 |
| `sendAction(action)` → Promise | ✅ (POST) | ✅ (ws.send) | 유지 |
| `getRoomState()` → `{myView}` | ✅ (GET) | ✅ (`{myView:lastView}`) | 유지 |
| `leaveRoom()` → Promise | ✅ | ✅ (manualClose+close) | 유지 |
| `onStateChange/onReconnected` | ✅ | (state push 내장) | 유지 |

**결론:** 게임 렌더 코드(`applyServerView`/`mpRender`/`mpOnEvent`)는 **거의 안 건드리고** 트랜스포트만 REST→WS로 교체 가능. 이게 승격이 현실적인 이유.

## 올라갈 것 (gostop 인라인 → lib 공용)

새 트랜스포트로 `lib/multiplayer.js`에 추가 (옛 클래스 유지하고 `MultiplayerWSClient` 신설 or `transport:'ws'` 모드):
1. **WS 연결 + demux**: `state`→onStateChange/applyView, `started`, `event`→onEvent, `presence/connected`→접속자수
2. **재접속**: `scheduleReconnect` backoff(1.2s×n, cap 5s) + `manualClose` 가드 + `reconnectTries`
3. **영속 uid**: localStorage `<game>_uid` (현재 `gostop_uid` 하드코딩 → 게임별 키)
4. **start 핸드셰이크**: `{type:'start', config:{seats,bet}}` + pendingStart(소켓 열리기 전 시작요청 큐)
5. **client 표면**: 위 표 그대로

## 남을 것 (게임별, gostop에 유지)
- `applyServerView`/`mpRender`/`mpOnEvent`/`mpAnimateEvent`/voice·SFX — 게임 렌더/연출
- `config:{seats,bet}` 값 — 게임별 파라미터
- 턴 배너(#mpTurn)·연결표시(#mpConn) DOM — **단, 연결표시 로직은 공용화 후보**(대기실 리디자인 C 트랙과 합류)

## POC-ism 정리 (승격 시 제거)
- ⚠️ `WORKER='wss://relay-do-poc.zuhejbeg.workers.dev'` 하드코딩 → config/RELAY_URL 파생으로
- ⚠️ `room=P.get('room')||'gs-test'` 테스트 방코드 → MultiplayerUI 방생성/입장 플로우에서
- ⚠️ 인라인 테스트 로비 innerHTML(1296~) → 실제 `MultiplayerUI`로 대체
- ⚠️ **이중 진입점 통합**: 현재 gostop은 `startMultiplayer()`(MP.ui+옛REST, 994줄)와 `startWS()`(DO POC, 1235줄)가 **병존**. 승격 = MultiplayerUI 로비 → 방 ready → WS 트랜스포트 핸드오프로 일원화.

## 승격 작업 순서 (GO 윈도우)
1. `MultiplayerWSClient`를 lib에 추가 (위 1~5), 공개 표면 = 옛 클래스와 동일
2. `MultiplayerUI`가 DO 워커에 방 생성/입장 후 WS 트랜스포트로 핸드오프 (REST 분기와 선택)
3. gostop: 인라인 `startWS` 제거 → lib WS 트랜스포트 사용, 렌더 코드 유지
4. Layer2 테스트(실 WS): 입장·start·action·event순서·재접속·leave
5. gostop 회귀 확인(do-v7 동작 패리티) → Reviewer → cocy 실기기
6. 이후 poker/mahjong/… 각 게임은 트랜스포트 한 줄 교체 + 렌더 유지로 포팅

## 함정 (이미 아는 것 + 신규)
- 공용 `/lib/multiplayer.js?v=` 캐시버스트 — 수정 후 전 게임 HTML `?v=` bump 필수 ([[lib-cache-version]])
- 전역 충돌: `RELAY_URL`/`_mpClientInstance`/`SharedWallet` 재선언 금지 ([[game-global-collision]])
- 옛 REST 게임들 회귀: WS 모드 추가가 기존 EventSource 경로를 깨면 안 됨 (트랜스포트 분기로 격리)
