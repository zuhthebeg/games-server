# DO 기본값 승격 (게이트 반전) 설계

상태: **설계 — 승인 대기** (2026-06-18). 코드 변경 없음. 승인 후 Wave 1부터 게임별 점진 실행.

## 목표
- 현재: 멀티 기본값 = REST 폴링(relay.cocy.io). DO는 `?relay=do` opt-in.
- 목표: **DO가 기본**, `?relay=rest`가 비상 탈출구. 게임별 점진 플립, 즉시 롤백 가능.
- 배경: 트래픽 ≈ 0 → 블래스트 작음. cocy 결정 = 점진·과감히·relay.cocy.io repoint.

## 선결 게이트 (각 wave 플립 전 필수)
- **Wave 1**: gomoku 빠른매칭 + 공개방 목록 2탭 실측 OK.
- **Wave 2**: gostop/mahjong/blackjack 2인 골드 증감 실측 OK (한 판 끝 양쪽 지갑 +/− 맞물림 확인).
- 통과 못 하면 그 게임은 플립 보류.

## 게이트 반전 메커니즘 (게임당 한 줄)
현재 게임별 인라인 게이트:
- `gomoku/connect4/pingtan/ppingpae/blackjack/mahjong`: `if (relay === 'do') startXxxDO()`
- `gostop/enhance`: `if (relay !== 'do') return`

권장 = 공용 판단 함수로 중앙화 (lib/multiplayer.js 정적 메서드 또는 lib/relay-mode.js):
```js
// DO 기본 여부. 우선순위: 명시 URL > 전역 킬스위치 > 게임별 기본(doDefault).
// 구현됨: lib/multiplayer.js (커밋 시점 default OFF=기존 opt-in과 동일, 채택해도 무영향).
MultiplayerWSClient.relayDefaultOn = function (doDefault) {
  var p = new URLSearchParams(location.search).get('relay');
  if (p === 'rest') return false;   // 명시 탈출 (양방향 escape hatch)
  if (p === 'do')   return true;    // 명시 진입 (테스트/공유링크)
  try { if (localStorage.getItem('relayKill') === '1') return false; } catch (e) {} // 전역 킬스위치
  return doDefault === true;        // 게임별 기본 (미지정=false)
};
```
- **2단계 채택(안전)**: ① 게임 게이트를 `relayDefaultOn(false)`로 교체 = 동작 100% 동일(헬퍼만 도입). ② 검증 후 `relayDefaultOn(true)`로 플립 = DO 기본. 도입과 플립을 분리.
- **게임별 플립** = 그 게임의 게이트를 `if (relay === 'do')` → `if (MultiplayerWSClient.relayDefaultOn(true))` 로 교체 (한 줄).
- **전역 즉시 롤백** = `localStorage.relayKill='1'` (어드민 토글로 노출 가능) 또는 URL `?relay=rest`.
- **게임별 롤백** = 그 게임 한 줄만 `=== 'do'`로 되돌림.
- lib 채택 시 `?v=` 캐시버스트 필수.

## 롤아웃 순서 (성숙도순, 게임별 하루 모니터)
| Wave | 게임 | 분류 | 선결 |
|---|---|---|---|
| 1 | gomoku → connect4 → pingtan | 순수 PvP (골드 위험 0) | gomoku 매칭 실측 |
| 2 | gostop → mahjong → blackjack | wallet (정산 배선 완료) | 2인 골드 실측 |
| 확인 | enhance (이미 mp-lobby/pvp-battle), ppingpae (분류 확인) | 개별 | 개별 |

각 게임: 플립 1줄 → push(자동배포) → `/stats`·콘솔 모니터 → 문제 시 그 게임만 즉시 rest 롤백.

## relay.cocy.io repoint (가장 까다로움 — REST 은퇴와 묶어야 안전)
- 현재 `wss://relay-do-poc.zuhejbeg.workers.dev` 하드코딩 = 7게임 + lib/multiplayer.js + lib/mp-lobby.js.
- **함정**: `relay.cocy.io`는 지금 REST games-server(CF Pages)를 가리킴. DO 워커로 그냥 옮기면 기존 REST 멀티가 죽음.
- 안전 순서:
  1. DO 워커 자체는 정상 동작 중(workers.dev). 먼저 전 게임 DO 플립 + 안정 확인.
  2. 워커 베이스 const를 lib 한 곳으로 중앙화 (지금 9곳 분산).
  3. CF에서 DO 워커에 custom domain/route 부여 (예: `relay.cocy.io/room|match|rooms` → DO 워커, 기존 `/api/*` → Pages 유지하거나 Pages 은퇴).
  4. const를 `wss://relay.cocy.io`로 교체 + `?v=` bump.
- repoint는 Phase C(REST 은퇴)와 동시에. 그 전엔 workers.dev 유지.

## Phase C — REST 은퇴 (전 게임 플립 + 안정 후)
- 각 게임 REST MultiplayerUI / 폴링 코드 제거 → DO 단일 경로.
- relay.cocy.io D1 방테이블 + 폴링 엔드포인트 은퇴 (과금/유지보수 0).
- relay-do-poc 워커 → 정식 이름/라우트 승격 + relay.cocy.io repoint.

## 리스크 & 모니터
- 블래스트: 게임당 1개. 트래픽 0이라 작음.
- 롤백: 게임별 1줄 or 전역 킬스위치 — 즉시.
- 모니터: 코디네이터 `/stats`(게임별 활성방/인원) + 어드민 멀티 대시보드 + 브라우저 콘솔 에러.
- money code(wallet 3게임)는 플립 전 2인 골드 실측 필수.

## 실행 체크리스트 (승인 후)
- [ ] `relayDefaultOn()` 헬퍼 추가 (lib, default ON, 단 채택 전엔 무영향)
- [ ] Wave 1: gomoku 플립 → 모니터 → connect4 → pingtan
- [ ] Wave 2: 2인 골드 실측 → gostop → mahjong → blackjack
- [ ] ppingpae/enhance 개별 확인
- [ ] 전 게임 안정 → 워커 베이스 중앙화 → relay.cocy.io repoint → REST 은퇴
