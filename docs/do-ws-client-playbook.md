# DO+WS 멀티 — 클라이언트 마이그레이션 플레이북

> 작성 2026-06-16. 짝 문서: [`do-ws-migration-plan.md`](./do-ws-migration-plan.md)(서버/전송 아키텍처).
> 이 문서는 **게임 클라이언트**를 DO+WS(server-authoritative)로 옮길 때 **반복되는 함정과 재사용 패턴**을 모은다.
> 근거: gostop PoC 마이그레이션(`game.cocy.io/gostop/?relay=do`)에서 실제로 밟은 버그들.

## 0. 핵심 멘탈모델 — "thin renderer"

싱글 게임은 클라가 **게임 루프를 직접 돌린다**: 액션을 단계로 쪼개 그 사이에 사운드/애니를 끼우고 `await`로 타이밍을 잡는다.
DO+WS 멀티에서 클라는 **게임 루프가 없다.** 서버가 `applyAction` 후 **최종 스냅샷(뷰) 1장**과 **이벤트 스트림**만 보낸다.

> ⚠️ 그래서 **"중간 상태"가 클라에 존재하지 않는다.** 먹은 패는 이미 무더기에 가 있고 바닥에서 빠져 있다.
> 사운드·애니·연출은 전부 **스냅샷 diff 또는 이벤트로 "무엇이 일어났나"를 역추론**해서 다시 만들어야 한다.

이 한 가지가 아래 모든 항목의 뿌리다.

---

## 1. 정체성 영속화 — 재접속/관전모드 버그 (★ 최우선)

**증상:** 나갔다 들어오면 빈 손패 관전모드처럼 보이고 플레이가 안 이어짐.
**원인:** 클라가 페이지 로드마다 **랜덤 user id**를 생성 → 재접속 = 서버 로스터에 없는 새 사람 → `getPlayerView`가 `seat:-1`, `myHand:[]` 반환(= 관전자), 액션도 `seat<0`으로 거절.
**서버는 정상이다.** same-id 재접속은 좌석/손패를 복원한다(테스트로 증명됨). 버그는 100% 클라의 id 발급.

**고침:**
```js
let user; try{ user = localStorage.getItem('<game>_uid') || ''; }catch(e){}
if(!user){ user = 'u-'+Math.random().toString(36).slice(2,8); try{ localStorage.setItem('<game>_uid', user); }catch(e){} }
```
**주의:** 같은 브라우저 2탭은 uid를 공유 → 같은 좌석 충돌. 2기기/2브라우저로 테스트.

---

## 2. 표시 닉네임 — `?n=`로 전달

**증상:** 상대 이름이 `u-lvzl0n` 같은 raw id로 표시.
**원인:** 서버 로스터가 `nickname = user id`로 채움(소켓 태그엔 id만 있음).
**고침(클라+서버 양쪽):**
- 클라: WS URL에 `&n=` + `encodeURIComponent(myNick())` 추가.
- 서버(RoomDO): `?n=` 파싱 → `acceptWebSocket(server, [user, nick])`로 **태그[1]에 닉 저장** → 로스터 `nickname: tags[1] || user`. (태그는 hibernation 넘어도 유지)

---

## 3. 사운드/보이스 — 이벤트 스트림으로 구동

**증상:** 싱글의 풍부한 효과음(따닥/쪽/뻑/피뺏기/족보 콜)이 안 나고, 거슬리는 기본음만 반복.
**원인:** 멀티가 서버 `event`를 **버리고** 스냅샷 diff로 generic 사운드만 침.
**고침:** 서버가 보내는 event(`{type:'event', seq, event:{type, payload}}`)를 `onEvent(ev)`에서 게임별 voice/SFX로 매핑. 싱글의 어휘를 그대로 재사용.
```js
// 예: gostop mpOnEvent — payload의 stags/stolen/ppuk/captured로 분기
if(ev.type==='play'){ if(stags.includes('따닥'))voice('ttadak'); else if(captured.length)sound('take'); ... }
```
**중복 방지 — `_eventDriven` 플래그:** 구(REST/SSE) 멀티는 이벤트가 없어 diff-사운드가 폴백으로 필요하다. DO 멀티는 이벤트로 처리하므로, 렌더의 diff-사운드는 `if(!_eventDriven)`로 **꺼야** 이중·반복음을 막는다.

> **서버 이벤트 계약:** voice/SFX에 필요한 필드(`cardId`, `stags[]`, `stolen[]`, `captured[]` 등)가 **와이어로 실제 전달되는지 테스트로 박을 것**(§7). 클라만 맞춰선 안 됨.

**족보/누적 콜:** "새로 완성된 족보만 1회" 같은 건 좌석별 메모리(`_voiced[seat]`)로 dedupe. 스냅샷은 누적값이라 매번 재계산 → 이미 외친 건 스킵.

---

## 4. 애니메이션 — 스냅샷 diff로 모션 복원

싱글의 fly 함수(`flyToPile`/`flyStolen`)는 **메커니즘(클론 날리기)은 재활용**하되, **구동부는 새로 짠다.**

- **출발 좌표가 사라진다:** 새 스냅샷엔 먹은 패가 이미 무더기에 있음. → **DOM 새로 그리기 "전"에** 현재 카드 좌표를 캡처(`getBoundingClientRect`).
- **무엇이 움직였나 역추론:** `prev` vs `new` 스냅샷 diff. "바닥에 있던 id가 이제 X의 cap에 있다 → X 무더기로 날린다."
- **식별자 필수:** 렌더 시 카드 img에 `data-id`, 플레이어 박스에 `data-seat` 박기(출발·도착 찾기).
- **게임 루프가 없으니 `await` 불가:** 클론은 `position:fixed` **fire-and-forget 오버레이**로 띄우고 자기 타이머로 제거. 다음 스냅샷이 애니 끝나기 전에 와도 **board 렌더는 독립적으로 정확**(innerHTML 재구성이 숨긴 카드도 되살림). → 명시적 큐 불필요.
- **격리:** 애니 코드는 전부 `try/catch`. 실패해도 화면 정확성에 영향 0.
- **이중표시 방지:** 정착 카드를 잠깐 `visibility:hidden` → 클론 도착(~440ms) 후 노출.

참고 구현: gostop `mpFly`/`mpFlyCaptures`(`game.cocy.io/gostop` index.html).

---

## 5. 싱글 잔여 UI 숨기기

멀티 진입(보드 표시) 시 싱글 전용 요소를 명시적으로 숨길 것. gostop은 싱글 상대 박스(`#spOpp`, "CPU" 라벨)가 안 숨겨져 멀티 화면에 "CPU"가 떴다 → 진입 함수에서 `display='none'`.
체크: 점수판 상대 영역, "CPU"/봇 라벨, 싱글 전용 버튼, 덱/뒤집기탄 UI 등.

---

## 6. 결과창·버튼 모드 분기

싱글 결과창 버튼([다시][메뉴로])을 멀티가 재사용할 때, `forEach`로 **전부 덮어쓰면** 둘 다 같은 동작이 됨(gostop은 둘 다 "메뉴로"가 됐었다).
- 멀티 재대국은 **방 리셋이 필요**(PoC 미구현) → 멀티에선 "다시" 숨기고 "메뉴로"만.
- 싱글 복귀 시 버튼 원복(싱글 새 게임 진입에서 `display=''` + 원래 onclick 복원).
- 떠날 때 `_eventDriven=false` 등 멀티 플래그 해제.

---

## 7. 테스트 — 2계층 E2E (UI 없이 자동 검증)

수동 "찍어먹기" 대신 자동화. `games-server/tests/`에 패턴 있음(`gostop-*`).

**Layer 1 — 게임엔진 풀게임 fuzz (node, 즉시):** 플러그인을 on-the-fly 트랜스파일, 시드 N판 끝까지 자동 플레이. 불변식 전수 검증: 턴가드·불법수 거절·손패 프라이버시·자원 보존·페이즈 라우팅·종료성·제로섬. `Math.random` 시드 주입으로 재현 가능.
**Layer 2 — DO 트랜스포트 (miniflare/workerd, 실제 WS):** 워커를 esbuild 번들 → miniflare 구동 → 실제 소켓 2개로 connect/start/deal/턴가드/라운드트립/**재접속 좌석유지**/**unknown id=관전**/**닉네임 흐름**/**이벤트 juice 계약** 검증.

> miniflare 함정: `scriptPath`가 마운트 루트 밖(`/tmp`)이면 workerd가 `..` 거부 → **인라인 `script` 문자열**로 넘길 것. WS는 `dispatchFetch(url,{headers:{Upgrade:'websocket'}})` → `res.webSocket` → `accept()`.

오디오/애니 **체감**만 사람 눈(브라우저) 영역 — 그 외 서버·프로토콜·데이터 계약은 100% 자동.

---

## 8. 게임별 마이그레이션 체크리스트

- [ ] **uid 영속화** (localStorage) — §1
- [ ] **닉네임** `&n=` 전달 + 서버 로스터 반영 — §2
- [ ] **이벤트→voice/SFX 매핑** + `_eventDriven`로 diff-사운드 차단 — §3
- [ ] 서버 이벤트가 연출에 필요한 **payload 필드** 싣는지 확인(+테스트) — §3/§7
- [ ] **fly/모션** diff 복원 + `data-id`/`data-seat` — §4
- [ ] **싱글 잔여 UI** 숨김 — §5
- [ ] **결과창 버튼** 모드 분기 + 떠날 때 플래그 해제 — §6
- [ ] **Layer 1+2 E2E** 추가, `npm test` 통과 — §7
- [ ] 전역충돌 점검: 인라인 `<script>`가 공용 lib 전역(`RELAY_URL`/`SharedWallet` 등) 재선언 금지(블록 전체 죽음, `node --check`로 못 잡힘)
- [ ] 캐시: 공용 `/lib/*.js` 수정 시 게임 HTML `?v=` bump

---

## 9. 미해결 공통 과제 (전 게임 공통으로 풀어야)

- **멀티 재대국** = 방 상태 리셋 프로토콜(서버). 지금은 새 방코드로 우회.
- **방 만료/좀비방 정리** — 쓰던 방코드 재사용 시 옛 게임 잔존.
- **진짜 관전모드 UX** — unknown id 입장 시 "관전 중" 표시(현재는 빈 보드).
- **공용 트랜스포트로 승격** — gostop은 게임전용 WS 훅으로 격리(공용 `multiplayer.js` 무수정). 전 게임 전환 시엔 `multiplayer.js` 내부를 WS로 갈고 공개 시그니처 유지(원 계획서 §2·Phase1) 검토.
