# 카탄(pingtan) DO/WS 마이그레이션 설계 — Relay Mode

작성: 2026-06-18 · 대상: pingtan(catan)을 나머지 7게임처럼 DO/WS로 전송계층 교체
결론: **B안(릴레이 모드)**. A안(서버 완전 이관) 폐기.

---

## 0. TL;DR

- pingtan은 **host-authoritative**: 10415줄 클라 엔진이 룰·AI·거래를 다 돌리고, relay.cocy.io는 단순 메시지 버스였다.
- catan.ts 서버 플러그인은 **이미 relay**다 (`applyAction`이 state를 안 바꾸고 action을 event로 뱉음). 서버에 엔진이 없어서 막힌 게 아니다.
- 진짜 막힌 지점 2개:
  1. **이벤트 형태 불일치** — DO+catan은 `{event:{type,playerId,payload}}`를 쏘는데, pingtan 클라는 `{seq, data:<원본 action>}`을 기대.
  2. **`__snapshot` 유실** — catan `applyAction`이 `action.payload`만 보존하고 top-level의 `__snapshot`(호스트 권위 상태)을 버림. 이게 host-authoritative 동기화의 핵심인데 사라짐.
- 따라서 작업은 "서버 재작성"이 아니라 **DO에 얇은 relay 패스스루 모드 추가 + pingtan 전송계층만 WSClient로 교체**.

---

## 1. 현재 아키텍처 대조

### 1.1 pingtan host-authoritative (현행, relay.cocy.io REST)
- 모든 클라가 로컬에 풀 엔진 보유. 액션을 로컬 낙관 적용.
- 발신 액션에 `__snapshot: createpingtanStateSnapshot()`(발신자의 적용 후 풀 상태)을 붙여 보냄.
- relay.cocy.io = 멍청한 버스: action POST → seq 부여 → SSE/폴링으로 `{seq, data:action}` 브로드캐스트.
- 수신 클라: `onMpEvent`가 `event.data`를 원본 액션으로 보고 적용. 로컬 적용 발산 시 `recoverFromActionSnapshot(data.__snapshot)`으로 스냅샷 복구 (index.html:8488, 8907).
- AI: 호스트만 (`handlesAI = !isMultiMode() || mpState.isHost`, index.html:4930).
- 거래: P2P, `activeTradeProposals` Map. TRADE_ACCEPT/REJECT도 `__snapshot` 첨부해 relay. (※ 과거 cursor의 "TRADE_ACCEPT 이중수락 버그"는 오진 — `PendingTrade`는 정의만 되고 미사용.)

### 1.2 DO 워커 server-authoritative (나머지 7게임)
- `handleAction`: `validateAction`(턴가드) → `applyAction`(서버가 룰 실행) → `getPlayerView` per-user → events+state 브로드캐스트.
- 서버가 게임 권위. 손패 프라이버시는 `getPlayerView`로 분리.

### 1.3 왜 그냥 안 붙나 (구체적 단서)
catan.ts를 DO에 태우면 흐름상 동작은 한다:
- `validateAction` → 항상 `{valid:true}` ✓
- `applyAction` → state 불변 + `events:[{type:action.type, playerId, payload:action.payload}]`
- `broadcastEvents` → `{type:'event', seq, event}` 전체 브로드캐스트 ✓ (sender 포함)
- `getAIAction` 없음 → runAI 스킵 ✓

**그런데 깨지는 이유:**
- catan `applyAction`이 만든 event = `{type, playerId, payload}`. WSClient는 `onEvent(d.event)`로 이 객체를 그대로 넘김 (multiplayer.js:705).
- pingtan `onMpEvent`는 `event.seq`와 `event.data`(=원본 액션, `__snapshot` 포함)를 읽음 (index.html:8897–8910). → 형태 안 맞음, `__snapshot` 없음 → 스냅샷 동기화 전멸 → 게임 발산.
- 게다가 catan은 `getPlayerView`가 self-sufficient 아님(min view) → 재접속 복원 불가. host-authoritative라 서버엔 풀 상태가 없으니 당연.

---

## 2. 결정: B (Relay Mode)

| | A) 서버 완전 이관 | **B) DO Relay Mode** |
|---|---|---|
| 작업량 | catan.ts에 10415줄 엔진 재구현 = 사실상 서버 재작성 | DO에 얇은 relay 분기 + pingtan 전송 스왑 |
| 리스크 | 매우 큼 (룰·AI·거래·setup·바다맵 전부 포팅) | 작음, 검증된 클라 엔진 그대로 |
| 치트방지 | 서버권위로 가능 | 안 됨 (현행과 동일, 회귀 아님) |
| 채택 | ✗ | ✓ |

근거: pingtan 클라 엔진은 이미 잘 돈다. 그걸 갈아엎지 말고 **폴링→WS 전송만** 바꾼다. relay.cocy.io가 하던 "순서 보장 메시지 버스" 역할을 DO가 더 잘한다(직렬화·seq·hibernation·연결당 과금).

---

## 3. 서버 설계 (DO 워커)

### 3.1 모드 키: 플러그인 플래그
catan.ts 플러그인에 선언적 플래그 추가. 룸 단위 URL 파라미터보다 깔끔(게임 본질 속성, 클라가 매번 안 보내도 됨).

```ts
// functions/games/catan.ts
export const catanPlugin: GamePlugin = {
  id: 'catan',
  relay: true,          // ← NEW. DO가 plugin 실행 대신 passthrough 릴레이.
  minPlayers: 2,
  maxPlayers: 4,
  ...
}
```
`GamePlugin` 타입에 `relay?: boolean` 옵셔널 추가. 기존 7게임은 미선언 → 영향 0 (additive).

### 3.2 DO 분기 — `room-do.ts`
`getPlugin()` 후 `plugin.relay === true`면 relay 경로.

**handleStart (relay 모드):**
- `createInitialState` **호출 안 함** (서버에 게임상태 없음).
- 로스터 구성 + `minPlayers` 게이트는 그대로 (1인 시작 방지).
- 센티넬 game 객체 저장: `game = { relay:true, finished:false, players, config }` — `live`/roster/reconnect 로직이 기대하는 `finished` 플래그 유지용.
- `{type:'started', players, config}` 브로드캐스트.
- 호스트 클라가 `started` 받고 → 풀 초기상태(맵·AI·setup) 빌드 → 첫 액션으로 `__snapshot` 붙여 브로드캐스트. 나머지는 스냅샷으로 동기화.
- `pushViews` / `runAI` **스킵**.

**handleAction (relay 모드):**
- `validateAction` / `applyAction` **스킵**.
- seq 부여, `action.__snapshot` 있으면 `storage.lastSnapshot`에 저장(재접속용).
- 전체 브로드캐스트: `{type:'event', event:{ seq, type:'action', data: action }}` — relay.cocy.io 이벤트 형태와 **정확히 일치**. 원본 액션 통째 보존(`__snapshot` 포함).
- sender 에코 정책: 현행 REST는 발신자도 자기 액션을 이벤트로 받았는가? → pingtan은 로컬 낙관적용 + 수신 시 dedup(`actionId`)으로 처리하므로 **전체 브로드캐스트(에코 포함) 유지**가 안전. (dedup은 onMpEvent의 actionId/seq 가드가 담당.)

**(재)connect (relay 모드, 진행 중):**
- `getPlayerView` 대신 저장된 `lastSnapshot`을 단발 이벤트로 전송:
  `{type:'event', event:{ seq, type:'action', data:{ type:'__resync', __snapshot: lastSnapshot } }}`
- pingtan은 이미 `applypingtanStateSnapshot` + 스냅샷부터 replay 로직 보유(index.html:8907) → 재접속 복원 동작.

### 3.3 건드리지 않는 것
- 로비(roster/ready/presence/hostUser 승계), coord 보고, zombie alarm, hibernation: **전부 모드 무관 공통** → 그대로 재사용.

---

## 4. 클라이언트 설계 (pingtan/index.html)

나머지 7게임과 동일 패턴: `?relay=do`면 REST `MultiplayerClient` → `MultiplayerWSClient`로 스왑. **엔진/onMpEvent/스냅샷 코드는 유지.**

1. **전송 스왑**: `?relay=do` 분기에서 WSClient 생성, URL `wss://relay-do-poc.../room/<room>?g=catan&u=<uid>&n=<nick>`.
2. **onEvent 어댑터**: 현행 `onMpEvent(events[])`는 배열·`event.seq`·`event.data` 기대. WSClient는 단건 `onEvent(d.event)` 전달. → `mpState.client.onEvent = (ev) => onMpEvent([ev])` 얇은 어댑터. (ev = `{seq, type:'action', data:action}` 형태로 서버가 맞춰줌 → 기존 파서 그대로 동작.)
3. **seq 전달 갭 수정**: WSClient `onEvent`는 `d.event`만 넘기고 top-level seq를 버림 → **서버가 seq를 event 객체 안에** 넣도록 3.2에서 설계함(`event:{seq,...}`). 클라 변경 최소화.
4. **start/ready/presence**: WSClient 공개 API가 REST와 동일 시그니처(`start/sendAction/leaveRoom/getMyUserId`) → 로비 배선 거의 그대로. `onRoster`로 명단, `onStarted`로 호스트가 초기상태 빌드 트리거.
5. **AI/거래**: 변경 없음. 호스트가 AI 돌리고 sendAction(+snapshot), 거래도 sendAction 경유 → DO가 relay. 클라 로직 무수정.
6. **버전 배너**: 로비에 `build do-relay-v1` 표시. lib 캐시버스트 `?v=` bump 필수(lib 수정 시).

---

## 5. 테스트 플랜 (배포 후 production 검증)

- **2인 2탭**: `?relay=do&room=ct1&u=a` / `&u=b` → "접속자:2" → 호스트 시작 → setup1 양쪽 동기화.
- **AI 채움**: 호스트가 빈자리 AI 패딩(`buildAiPlayers`) → AI 턴 진행이 양쪽에 동일 반영.
- **거래**: 인간↔인간 TRADE_ACCEPT, 인간↔AI → 자원 이동 양쪽 일치.
- **재접속**: 진행 중 한 탭 새로고침 → `lastSnapshot` resync로 보드 복원.
- **바다맵/도시/기사**: 스냅샷에 포함되는지 확인(ckKnights, ships).
- **승리**: 10점 → winner 표시 양쪽 동기화.
- **호스트 이탈**: 호스트 탭 닫음 → DO hostUser 승계 + 새 호스트 클라가 엔진 권위 인수되는지 (※ 리스크, 5.1 참조).

### 5.1 리스크 / 미해결
- **호스트 마이그레이션**: 호스트 떠나면 AI·거래 권위 공백. DO는 hostUser 승계하지만, 새 호스트 클라가 `lastSnapshot`에서 엔진 권위를 이어받아야 함. pingtan에 host_changed 핸들링 있는지 확인 필요 → 없으면 별도 청크.
- **스냅샷 크기**: 액션마다 풀 상태 브로드캐스트(현행 REST도 동일, 회귀 아님). WS라 메시지 과금 0 → OK. 대역폭만 주의.
- **프라이버시**: 풀 스냅샷 전체 브로드캐스트 → 개발카드/손패 클라에 노출(현행과 동일). 치트방지는 B 범위 밖.

---

## 6. 작업 분해 (착수 순서)

1. `GamePlugin` 타입에 `relay?: boolean` + catan.ts에 `relay:true`. (서버, 5분)
2. `room-do.ts`에 relay 분기: handleStart/handleAction/connect 3곳 + lastSnapshot 저장. (서버, 핵심)
3. 워커 배포 + WS 핑(action relay echo + seq 단조 + resync) 스모크.
4. pingtan `?relay=do` 분기: WSClient 스왑 + onEvent 어댑터 + 버전배너. (클라)
5. 클라 푸시(게임 repo) + production 2탭/AI/거래/재접속 검증.
6. 호스트 마이그레이션 별도 평가 → 필요시 후속 청크.

각 단계 git commit → push → (워커는 wrangler) deploy 순서 준수. 배포 전 git HEAD = 배포대상 확인.
