# 멀티 마이그레이션 — 루프 실행 상태파일

> "The agent forgets, the repo doesn't." 이 파일이 루프의 기억이다.
> 짝 문서: [`do-ws-migration-plan.md`](./do-ws-migration-plan.md)(아키텍처), [`do-ws-client-playbook.md`](./do-ws-client-playbook.md)(게임별 클라 포팅 함정).
> 분석/설계 근거: page.cocy.io/loop-engineering (Addy Osmani, Loop Engineering 적용).
> 작성 2026-06-17.

## GOAL (종료조건)

전 멀티게임을 DO+WebSocket(server-authoritative)로 이관한다. 게임 1개는 아래를 **전부** 만족해야 `done`:

- [ ] Layer1(엔진 풀게임 fuzz) + Layer2(실WS 트랜스포트) 테스트 통과
- [ ] 싱글 동작 패리티(턴 모델·사운드/애니 계약·점수)
- [ ] Reviewer(다른 에이전트) 독립 검토 pass
- [ ] cocy 실기기 한 판 확인 (최종 게이트 — 사람만 가능)

전체 done = 위를 12개 게임 전부 + 공용 `multiplayer.js` 승격 완료.

## 루프 한 바퀴 (발견→분류→수정→검증)

```
1. 발견  backlog에서 status=todo · deps 충족된 게임 1개
2. 분류  플레이북 체크리스트로 작업범위 산출 (Maker)
3. 수정  Maker(Claude) 포팅 + Layer1·2 테스트 → npm test green
4. 검증  Reviewer(다른 모델) 독립 검토 → verdict
         pass → status=reviewed, 이 파일 갱신, 1로
         fail → 지적 backlog에 적고 Maker로 (한 바퀴 더)
5. 보고  reviewed 된 것만 cocy에게 "검토통과 + 실기기확인 요청"
```

동시 실행은 검토 여력이 상한. 지금은 1~2개. 2개 이상 동시 포팅 시에만 worktree 격리(`Agent isolation:"worktree"` / 게임별 분리 세션).

## Maker / Reviewer 계약

**모델 분배(2026-06-17 cocy 지시):** Sonnet은 별도 사용량 레인(5h 윈도우에 가볍게 실리고 Opus 주간캡 안 건드림). 단순/기계적 청크 = **Sonnet Maker**(`Agent model:sonnet`), 판단·blast-radius·리뷰 = **Opus**. Opus 5h가 SLOW여도 멈추지 말고 기계적 청크를 Sonnet으로 돌려 전진. STOP은 Opus·Sonnet 둘 다 조일 때만.
- Sonnet 적합: 스펙 명확한 additive 코드, 테스트 스캐폴드, 단일 게임 트랜스포트 교체, 문서/정리
- Opus 전담: 공용 lib 설계 결정, 배포 게이트, 인코딩/인증, 디버깅, Sonnet 산출물 리뷰

**Maker** = Sonnet(기본) 또는 Opus(설계난이도 높을 때). 포팅 + 테스트 작성 + 자가 `npm test`.
**Reviewer** = Opus(현재 gemini/gpt 소진). 읽기전용, 구조검증(additive/충돌/표면일치) + 핵심 로직만. 같은 계열 self-bias 유의.

Reviewer 입력 계약:
- diff (해당 게임 client + 필요시 server plugin)
- 체크리스트: `do-ws-client-playbook.md` §8
- 싱글 동작 스펙(해당 게임 index.html 원본 동작)

Reviewer 출력(구조화):
```json
{ "verdict": "pass|fail",
  "blocking": ["치명/플레이불가 이슈"],
  "nits": ["사소"],
  "missed": ["놓친 모달리티/미검증 주장"],
  "self_bias_flag": true|false }
```

강도 분기: 빠른 패리티=가벼운 모델, 지갑/결제/정산 얽힌 변경=강한 모델+깊은 추론.

## 백로그

| 게임 | plugin | status | deps | 비고 |
|---|---|---|---|---|
| gostop | gostop.ts | **reference (진행중 do-v7)** | — | 안정화 끝나면 승격 기준점 |
| **multiplayer.js 승격** | lib | todo | gostop reviewed | DO/WS+uid+닉+재접속을 공용 트랜스포트로. 공개 시그니처 유지 | poker.ts | todo | 승격 | 카드 렌더 재활용 |
| mahjong | mahjong.ts | todo | 승격 | 헤더 예약(56px) 주의 |
| blackjack | blackjack.ts | todo | 승격 | |
| ppingpae | ppingpae.ts | todo | 승격 | SharedWallet init 확인 |
| gomoku | gomoku.ts | todo | 승격 | 순수 턴제(쉬움) |
| connect4 | connect4.ts | todo | 승격 | 순수 턴제(쉬움) |
| pvp-battle | pvp-battle.ts | todo | 승격 | |
| bulletdodge | bulletdodge.ts | todo | 승격 | 실시간성 — 전송빈도 검토 |
| enhance | enhance.ts | todo | 승격 | |
| catan/pingtan | catan.ts | todo + ⚠️trade | 승격 | **TRADE_ACCEPT 서버권위 승격 필요**(이중수락 버그) |
| echo | echo.ts | n/a | — | 배관 테스트용, 포팅 불필요 |

⚠️trade = DO 이관 시 `pendingTrade{open}` + 첫 수락만 성사로 서버 심판화 추가.

## 대기실 리디자인 (C) — 설계 우선 트랙

loop가 아니라 설계 우선(와이어프레임 → 단일게임 적용 → 공용화).
- 방 목록 / 빠른매칭 / 방코드 입장
- 좌석·준비(ready) 상태 표시
- 재대국 버튼 (서버: 좀비방 리셋 이미 절반 구현 — finished면 새 start로 리셋)
- 관전 진입(unknown id = 관전, 현재 빈 보드 → "관전 중" UX)
- 연결 상태(끊김/재접속) 표시 — gostop do-v7에 1차 구현됨, 공용화 후보

## RESUME PROTOCOL + 사용량 게이트 (새 세션/압축 후 실행)

> 짝 파일: [`loop-cursor.json`](./loop-cursor.json) = 기계 상태(지금 어디). 이 프로토콜 = 알고리즘.
> 목적: Claude 사용량(=context %)을 보며 작업을 청크로 쪼개고, 초기화(compaction) 후에도 끊김 없이 재개.

```
0. 재개   loop-cursor.json 읽기.
          active=false → 자동 실행 금지. cocy "재개"/명시 지시 대기.
          active=true  → 1로.

1. 사용량  scripts/claude-usage.sh --gate → Claude 구독 5h 윈도우 판정
          (Claude Code /usage 탭과 동일. 리셋 시각도 나옴. context %는 압축 트리거일 뿐 게이트 아님.)
          GO   (5h<70%)            → 정상 청크 시작 가능
          SLOW (5h 70~90%)         → 작은 청크만, 리셋(resets_at)까지 보수적, 끝나면 즉시 flush
          STOP (5h>=90% or 7day>=95%) → 청크 시작 금지. cursor flush + 보고 후 STOP.
                                       리셋 시각을 cursor.resumeAfter에 적고 그때 재개.

2. 선택   work = cursor.current(재개) 또는 backlog의 todo(deps 충족) 1개.
          blockedOn=human 이면 자동 진행 불가 → cocy에 게이트 요청 후 STOP.

3. 한 청크 = 루프 한 바퀴의 '한 조각'. 게임 1개 통째가 아니라:
          분류(체크리스트) / 수정 1파트 / Layer1테스트 / Layer2테스트 / 리뷰반영
          중 한 단위. 청크는 항상 git commit 가능한 상태로 끝낸다.

4. 검증   npm test green → commit (games / games-server 각각).

5. 갱신   loop-cursor.json 갱신(current·next·lastCommit·updated) → 1로 돌아가 재측정.

6. 종료   아래 중 하나면 cursor flush + 진행로그 1줄 + STOP:
          - Context >72%
          - Claude failover/쿼터 소진
          - blockedOn=human (실기기·승인 필요)
          - 청크 3바퀴째 같은 실패 반복(에스컬레이션)
```

**불변식:** cursor 파일은 매 청크 끝과 **압축 직전(pre-compaction flush)** 에 반드시 최신. "에이전트는 잊어도 cursor는 안 잊는다." 보고는 reviewed/blocked 상태 변화가 있을 때만(무변화 무보고).

## 진행 로그

- 2026-06-17: 상태파일 생성. gostop do-v7(폭탄 FLIP 턴모델·턴배너·재접속·좀비방리셋)까지 안정화. Reviewer 분리 체계 설계(이 문서 + page.cocy.io/loop-engineering). 다음 = gostop cocy 실기기 확인 → 공용 승격(2번) 착수.
