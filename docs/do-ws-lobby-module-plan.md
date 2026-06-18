# DO-WS 공용 로비 모듈 계획 (`MultiplayerLobby`)

목표: 게임마다 손으로 짜는 인라인 미니로비(`?relay=do` 훅)와 레거시 `MultiplayerUI`(relay.cocy.io/D1/SSE)를
**WS/DO 위에서 도는 단일 재사용 모듈**로 대체한다. 로비 UX 재설계 + 끝난 방(좀비) 정리 + 재대결을 공용화.

## 현재 상태 (2026-06-17)

- **레거시 스택**: `lib/multiplayer.js`의 `MultiplayerClient`(REST+SSE→relay.cocy.io/D1) + `lib/multiplayer-ui.js`(1287줄 풀 로비). UI가 레거시 클라에 하드와이어.
- **신규 전송**: 같은 파일의 `MultiplayerWSClient`(WS→`relay-do-poc`/RoomDO). 액션 표면(sendAction/start/onStateChange/onEvent/onPresence/sendProfile)만 있고 **로비 UI 없음**.
- **게임 7개**(enhance/blackjack/gostop/connect4/gomoku/mahjong/ppingpae)가 각자 인라인 미니로비를 손으로 짬 → 중복·UX 제각각.
- **DO 갭**: 끝난 방=좀비(시작 시 리셋만, 능동 정리 없음), presence=카운트만(명단 없음), ready 추적 없음, 랜덤매칭/공개방목록 없음(방별 DO라 레지스트리 부재).

## 신규 모듈 설계

### 클라: `lib/mp-lobby.js` — `MultiplayerLobby`
`MultiplayerWSClient` 위에 로비+방 라이프사이클을 얹은 드롭인. `MultiplayerUI`와 유사 시그니처.

```js
const lobby = new MultiplayerLobby({
  gameType, gameName, maxPlayers, minPlayers,
  container,                 // 마운트 DOM
  getPlayerData,             // () => 프로필(무기 등) — start/ready/rematch에 사용
  onGameStart(view),         // 게임 시작(최초/재대결)
  onGameEvent(type, data),   // 'state_update' / 이벤트 패스스루
  onLeave(),                 // 메뉴로
  workerBase,                // 기본 wss://relay-do-poc...
});
```
담당: ?room/?u 파싱(없으면 탭별 uid 생성) → 로비(코드 입장 / 링크·QR 공유 / presence 명단 / ready 토글 / 호스트 시작) → 대기실 → 인게임 패스스루 → 결과 오버레이(재대결/퇴장) → 재접속. CSS는 `multiplayer-ui.js`의 `mp-ui-styles`를 재사용/이식.

### 서버: `realtime-poc/src/room-do.ts` 추가 (전부 additive)
1. **roster 브로드캐스트**: join/leave/ready 시 `{type:'roster', players:[{user,nick,ready}], connections}` → 대기실이 이름+ready 표시.
2. **ready 처리**: `msg.type==='ready'` → 유저별 ready 저장. 호스트 시작은 min 충족 + (옵션) 전원 ready.
3. **끝난/빈 방 정리(좀비)**: `webSocketClose`로 소켓 0 → `alarm(+60s)` 예약 → 발화 시 game/profiles/seq/ready storage 삭제. 그 전에 재접속하면 alarm 취소. 게임 finished + 전원 leave도 정리.
4. **재대결**: 이미 지원(finished+start→리셋). roster ready만 리셋하면 됨.

## 갱신 (2026-06-18) — 그린필드 아님, gomoku에서 **추출**

이 계획 작성 후 gomoku의 인라인 `?relay=do` 경로에서 전 기능을 직접 구현·실전검증했다.
이제 남은 일은 "gomoku에서 검증된 코드를 공용 모듈로 들어내는 것"이다. 레퍼런스 = **gomoku**(enhance 아님).

**이미 끝난 것 (서버, 전 게임 적용됨):**
- ✅ roster/ready 브로드캐스트, host 승계
- ✅ 재대결: `handleStart`가 `game.finished || (!relay && isGameOver())`로 종료 판정 → 끝난 판 리셋. (gomoku/connect4/blackjack/enhance/pvp-battle는 `finished` 미설정 + `isGameOver`만 써서 기존엔 재대결이 깨져 있었음 — 수정 완료)
- ✅ 새 판 시작 시 `ready={}` 초기화
- ✅ 의도적 나가기: `{type:'leave'}` → `handleLeave`가 진행 중이면 `opponent_left` 이벤트 브로드캐스트 + game/seq/ready 정리. 단순 close(튕김)는 안 탐 → 재접속 동선 유지
- ✅ 빈 방 alarm 정리(ZOMBIE_TTL)

**이미 끝난 것 (클라 전송, `lib/multiplayer.js`):**
- ✅ `MultiplayerWSClient`에 `setReady`/`start`/`sendAction`/`leaveRoom`/**`leave`**(close 전 `{type:'leave'}`)/`onRoster`/`onEvent`/`onPresence` 등 표면 완비

**gomoku에서 검증된, 들어낼 클라 UI 로직 (현재 인라인):**
- 닉 해석 + SharedWallet 완료대기(`swReady` — `init()`이 `_initialized`를 동기로 세워 재호출 await로는 로그인 fetch를 못 기다리는 함정 포함)
- chooser(빠른대전/공개방목록/새방/코드입장) + 대기실(시작 + **대기실 복귀** 버튼)
- 재대결 합의(내 ready→상대 제안표시→수락→호스트 start) + opponent_left 종료 + 결과 오버레이
- myColor를 매 상태마다 view에서 갱신(재대결 시 좌석/색 스왑 대응)

## 공용 모듈 API (확정안) — `lib/mp-lobby.js` `MultiplayerLobby`

```js
const lobby = new MultiplayerLobby({
  workerBase: 'wss://relay-do-poc.zuhejbeg.workers.dev',
  gameType: 'gomoku', gameName: '⚫⚪ 오목', build: 'do-v1',
  // ── 게임 콜백 ──
  onState(view) {...},              // 필수: 매 상태 → 보드/턴 렌더 (myColor는 view.myColor에서)
  result(view) {                    // 필수: 끝났을 때만 호출(모듈이 '새로 끝남' 감지)
    const win = view.winner === view.myColor;
    return { title, detail, isWin: win, goldDelta: win ? 1_000_000 : -100 }; // goldDelta는 모듈이 SharedWallet에 정산
  },
  isOver: (view) => !!view.winner,  // 선택, 기본 view.winner||status==='finished'
  onEnter(view) {},                 // 선택, 첫 진입 1회
  startConfig: () => ({}),          // 선택, start 패킷 config
});
lobby.start();          // ?room=/?u= 파싱 → chooser or 직접 connect
lobby.send(action);     // = client.sendAction
lobby.getMyUserId();
lobby.exit();           // 인게임 '나가기' → leave() + chooser 복귀
```

**모듈 소유:** SharedWallet 대기+닉해석 / chooser / 대기실(+복귀) / WS 라이프사이클(재접속·presence) / 재대결 합의 / 결과 오버레이(재대결·퇴장·상대나감) / opponent_left / **골드 정산(SharedWallet)**.
**게임 소유:** 보드 상태·렌더(`onState`), 입력→`lobby.send()`, 턴/색(view에서), 결과 텍스트·골드델타(`result`).
효과: 게임당 DO 코드 ~250줄 → ~30줄(config + onState 렌더 + result).

## 실제 결정 (2026-06-18) — gomoku는 인라인 유지, 모듈은 모델 A로 통일

발견: `lib/mp-lobby.js`(`MultiplayerLobby`)는 이미 존재했고 **enhance가 라이브로 사용 중**(MultiplayerUI 호환 API). 단 이번 세션 하드닝이 빠진 구버전. → 새 모듈 포크 금지, 기존 모듈을 정본으로 진화.

cocy 결정: **gomoku는 인라인 그대로(검증된 오버레이 합의 UX, 회귀위험 0). 나머지(enhance 등)는 모듈 + 모델 A**.

**재대결 모델 2종 공존(의도적):**
- gomoku = **모델 B**(결과 오버레이 제안/수락, 인라인) — 안 건드림
- 모듈 = **모델 A**(대기실 합의): '다시 대전'→`goToWaitingRoom`→양쪽 ready→호스트 시작

**모듈 반영 완료(커밋 a6eb6a8):** resolveNick(로그인닉+walletReady) / 모델A(start 단독발사 제거) / opponent_left 모듈 처리 / 종료판정 winnerId‖winner 일반화. enhance `?v=20260618A`.

## 단계

- ✅ **Phase 1(완료)**: 모듈 하드닝 + 모델 A 통일. enhance 정본 소비자. (검증: enhance 2탭 — 닉/재대결합의/상대나감 cocy 확인 대기)
- **Phase 2(진행)**: 인라인을 모듈로 1개씩 이관. gomoku는 보류.
  - ✅ **connect4**(커밋 4b273be): startConnect4DO→MultiplayerLobby(3인,min2). handleGameEvent state_update 라우팅, exitGame usingLobby 분기, 기존 DO showResult(mpUI=null) 크래시도 해소. 서버 계약 스모크 통과.
  - ✅ **gostop**(커밋 f781782): DO IIFE 인라인 WS+로비 제거→MultiplayerLobby(2인 PoC,seats:2). 렌더/voice(mpOnEvent)/제로섬 settle(mpResult) 유지. '다시'=model A 재대결(기존 TODO 해소). MP.client=lobby, lobby.leaveRoom 추가. 서버 스모크(딜 10장) 통과.
  - **UI 2탭 검증 cocy 대기**(connect4+gostop) — 서버 계약만 검증됨, 클라 UI 배선은 브라우저 필요.
  - **남음(각각 bespoke 어댑터 — 일괄 아님)**:
    - **blackjack**(6인): mpUI shim(getState/getPlayerData/event 버퍼)+inline 결과렌더+new_round 재대결. getState 패스스루+getPlayerData opt 필요. showResult 충돌 주의.
    - **mahjong-tw**(1인+AI3): step-replay 렌더(3s 페이싱)+getRoomState 폴링 shim. 휴먼 합의로비 가치 낮음(AI전). 트랜스포트/닉만 이득.
    - **ppingpae**: mpState+AI 구동+inline 결과. 위와 유사.
  - 판단: 위 3종은 결과/재생/AI 처리가 제각각이라 mirror 불가 → 1개씩 어댑터 작성+2탭 검증 권장. flag-gated라 라이브 무영향(저위험)이나 블라인드 일괄은 미검증 리스크 누적.
- **Phase 3**: 랜덤매칭+공개방목록 코디네이터 DO 고도화. 전 게임 이관 후 레거시 `MultiplayerClient`/`MultiplayerUI` 폐기 검토.

## 불변식 / 함정
- 공용 lib 수정 → 소비 게임 HTML `?v=` bump 필수([[feedback_lib_cache_version]]). 새 `?v=`는 Pages 빌드 후 fetch(CDN 오염 방지).
- 인라인 전역 충돌 금지(RELAY_URL/SharedWallet 등) — 모듈은 IIFE/클래스로 격리.
- 서버 변경은 `relay-do-poc` 워커 수동 `wrangler deploy`(이번 라운드 서버 작업은 완료됨).
- 게임 로직 리듀서(`functions/games/*.ts`)는 손대지 않음 — 전송/로비 계층만.
- `result()`가 끝난 view마다 한 번만 호출되도록 모듈이 over 전이(edge)를 추적(중복 정산 방지).
