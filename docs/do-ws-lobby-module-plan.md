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

## 단계 (라이브 9게임 안 깨고)

- **Phase 1 (지금)**: `lib/mp-lobby.js` + 서버 roster/ready/cleanup. **enhance를 레퍼런스로 이관**(인라인 do-lobby→MultiplayerLobby, `?relay=do` 플래그 게이트, 레거시 유지). 2탭 검증(명단/ready/재대결/좀비정리).
- **Phase 2**: 나머지 6개 ?relay=do 게임을 1개씩 이관(각자 커밋·검증, 롤백=플래그 off).
- **Phase 3**: 랜덤매칭+공개방목록 = 코디네이터 DO(레지스트리). 전 게임 이관 후 레거시 `MultiplayerClient`/`MultiplayerUI` 폐기.

## 불변식 / 함정
- 공용 lib 수정 → 소비 게임 HTML `?v=` bump 필수([[feedback_lib_cache_version]]). 새 `?v=`는 Pages 빌드 후 fetch(CDN 오염 방지).
- 인라인 전역 충돌 금지(RELAY_URL/SharedWallet 등) — 모듈은 IIFE/클래스로 격리.
- 서버 변경은 `relay-do-poc` 워커 수동 `wrangler deploy`.
- 게임 로직 리듀서(`functions/games/*.ts`)는 손대지 않음 — 전송/로비 계층만.
