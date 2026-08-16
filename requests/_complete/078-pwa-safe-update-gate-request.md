# 077 — PWA Safe Update Gate / Stale Client Prevention Request

## 0. 목적

K-Bestie PWA에서 장시간 구버전 클라이언트가 살아 있는 상태로 신규 Production 배포가 발생할 때, stale client / version skew / asset mismatch로 Mission·Free Chat이 중단되는 위험을 줄이기 위한 업데이트 정책을 구현한다.

이번 작업의 핵심 원칙:

```text
대화 중에는 업데이트 강제 안 함
→ 세션이 1시간 이상 경과하면 다음 안전한 초기화면 재진입 시 업데이트 여부 체크
→ 업데이트가 없으면 정상 진입
→ 업데이트가 있으면 화면 정중앙 blocking modal 표시
→ 업데이트 완료 전 Mission / Free Chat / 주요 기능 진입 금지
→ 사용자가 우회 시도하면 "업데이트를 진행하세요" 경고
→ 업데이트 완료 후 최신 버전으로 reload
```

업데이트 확인은 대용량 asset 다운로드가 아니라 version/deployment 정보만 비교한다.

---

## 1. 최종 정책 — 확정

### 1.1 Active Conversation 중

Mission / Free Chat 등 실제 대화 세션 진행 중에는:
- 새 버전이 발견돼도 강제 reload 금지
- 새 Service Worker 즉시 강제 활성화 금지
- 현재 Mission / Free Chat session 종료 금지
- 현재 turn 중단 금지
- 화면 중앙 업데이트 modal 강제 표시 금지

업데이트 존재 여부만 내부적으로 기억할 수 있다.

핵심:
> 사용 중인 대화를 업데이트 때문에 끊지 않는다.

### 1.2 세션 1시간 경과

현재 app/conversation session이 1시간 이상 경과하면:
- 즉시 진행 중 대화를 강제로 끊는 것이 아님
- 다음 안전한 navigation / 초기화면 재진입 시 update check를 반드시 수행
- background 복귀, session 종료 후 home/init 진입 등 현재 lifecycle에서 가장 안전한 전환 지점을 사용

`1시간`은 업데이트 존재를 의미하는 값이 아니라:
> 다음 초기화면 진입에서 버전 확인을 강제하는 기준
이다.

---

## 2. 초기화면 Update Check

초기화면 진입 시 version check를 수행한다.

확인 정보 최소:
```text
current_client_deployment_id
latest_deployment_id
current_build_sha
latest_build_sha
current_sw_version
latest_sw_version
```

실제 프로젝트에 이미 존재하는 version API / client-version handshake / deployment id 구조를 우선 재사용한다.

새로운 중복 버전체계를 만들지 않는다.

업데이트 체크는 version metadata만 확인하며 전체 JS/CSS asset을 미리 다운로드하는 행위가 아니다.

---

## 3. 업데이트 없음

```text
current version == latest version
```

이면:
- modal 표시 없음
- 경고 없음
- 정상 초기화면 진입
- Mission / Free Chat 정상 사용

업데이트가 없는데 사용자를 차단하면 안 된다.

---

## 4. 업데이트 있음 — 중앙 Blocking Modal

업데이트가 존재하면 하단 banner가 아니라 화면 정중앙에 blocking modal을 표시한다.

예시:

```text
새로운 버전이 준비됐어요

더 안정적으로 사용하려면
먼저 앱을 업데이트해 주세요.

[ 업데이트 ]
```

정책:
- 화면 중앙
- background dim
- outside click으로 닫기 금지
- ESC/back gesture로 우회 금지
- `나중에` 버튼 없음
- `닫기` 버튼 없음
- 업데이트 완료 전 주요 기능 진입 금지

---

## 5. 업데이트 미실행 시 우회 차단

사용자가 업데이트 modal 상태에서:
- Mission
- Free Chat
- Play
- 기타 주요 기능

으로 이동을 시도하면:

```text
업데이트를 진행하세요.
```

경고를 표시하고 navigation을 막는다.

---

## 6. 업데이트 버튼 실행

사용자가 `[업데이트]` 클릭:

```text
version re-check
→ Service Worker registration.update()
→ waiting worker 확인
→ 안전한 activation
→ controllerchange 확인
→ hard reload
→ 최신 deployment/version handshake
→ 앱 정상 진입
```

현재 프로젝트 Service Worker 구조를 먼저 조사하여 정확한 lifecycle에 맞춘다.

중요:
- `skipWaiting()`을 무조건 남발하지 않음
- old page + new worker 혼합 상태를 만들지 않음
- controller 전환 완료 여부를 확인
- reload 이후 실제 latest deployment인지 검증

---

## 7. 업데이트 실패 UX

### 성공
```text
업데이트 완료
→ reload
→ 최신 버전 진입
```

### 실패
```text
업데이트 중 문제가 생겼어요.
인터넷 연결을 확인하고 다시 시도해 주세요.

[ 다시 업데이트 ]
```

실패 시:
- 구버전 주요 기능으로 우회 진입 금지
- 무한 spinner 금지
- 재시도 가능
- error telemetry 기록

---

## 8. 네트워크 불가 시

초기화면 version check 자체가 실패한 경우와 업데이트가 존재하는 경우를 혼동하지 않는다.

```text
A. version check success + no update
→ 정상 진입

B. version check success + update exists
→ blocking update modal

C. version check failed because offline/network error
→ 네트워크 오류 상태
```

C를 `업데이트 있음`으로 오판하지 않는다.

---

## 9. Stale Client / Asset Failure Self-Heal

현재 active conversation 중에는 업데이트 강제 금지가 원칙이지만, 실제로 다음 fatal 오류가 발생하면 별도 emergency recovery를 허용한다.

예:
- ChunkLoadError
- dynamic import failure
- stale asset 404가 확인 가능한 경우
- deployment mismatch fatal initialization failure
- Service Worker/client version mismatch로 정상 기능 진입 불가

이 경우:

```text
현재 session의 durable server state 보존
→ "새 버전으로 다시 연결할게요" 복구 안내
→ update/reload
→ 기존 Mission이면 동일 business_date/session 복구
→ Free Chat이면 가능한 범위에서 안전 재진입
```

단순 update availability와 fatal stale-client recovery는 별개 상태로 구현한다.

---

## 10. Mission Resume 안전성

업데이트 이후 Mission은 새 Mission을 만들면 안 된다.

```text
오늘 IN_PROGRESS Mission 존재
→ 동일 Mission resume

오늘 COMPLETED Mission 존재
→ 완료 상태 유지

새 Mission 생성
→ 금지
```

마지막 durable checkpoint부터 정상 이어가야 한다.

업데이트 때문에:
- Goal Progress reset 금지
- reward 중복 금지
- event 중복 금지
- session duplicate 금지

---

## 11. Free Chat 안전성

Free Chat update 이후:
- 기존 reward daily eligibility 중복 지급 금지
- 동일 business_date의 Free Chat reward 최대 +1 유지
- update reload 자체를 새로운 reward session으로 오판하지 않음

---

## 12. 현재 하단 Update Banner 처리

현재 존재하는:
```text
새로운 버전이 준비됐어요.
현재 대화를 마친 뒤 업데이트할게요.
```

하단 banner 정책을 전수 조사한다.

최종 정책:

### Active conversation 중
- 필요하면 비차단 informational 표시 가능
- 또는 UX 단순화를 위해 숨겨도 됨
- 절대 reload 강제 금지

### Safe initial/home screen
- update exists이면 중앙 blocking modal로 승격

하단 banner만 띄워두고 무기한 stale client 사용을 허용하는 구조는 폐기한다.

---

## 13. Version Source of Truth

업데이트 판단은 하나의 Source of Truth를 사용한다.

우선 조사:
- `client_version_events`
- current deployment id
- Vercel deployment id
- build sha
- service worker version
- existing `/api/client-version`
- `StaleClientRecovery`
- `PwaServiceWorker`

최종 판단 예:
```text
updateAvailable =
  currentDeploymentId !== latestDeploymentId
  OR waitingServiceWorkerExists
```

실제 프로젝트 구조에 맞춰 최소 신뢰 가능한 조건을 사용한다.

---

## 14. 1시간 Session 기준

1시간 기준의 정확한 Source of Truth를 조사한다.

후보:
- app session started_at
- current Mission/FreeChat session start
- foreground accumulated duration
- current client version loaded_at

중요:
- 브라우저가 background에 오래 있다가 돌아온 경우에도 다음 foreground/init 진입에서 update check를 확실히 수행
- 단순 setTimeout 60분만 사용하지 않음

---

## 15. Telemetry

최소 이벤트:

```text
pwa_update_check_started
pwa_update_check_no_update
pwa_update_available
pwa_update_modal_shown
pwa_update_clicked
pwa_update_activation_started
pwa_update_success
pwa_update_failed
pwa_update_gate_blocked_navigation
pwa_stale_client_detected
pwa_stale_client_recovery_started
pwa_stale_client_recovery_success
pwa_stale_client_recovery_failed
```

최소 correlation:
- child_id
- app_session_id
- current_deployment_id
- latest_deployment_id
- route
- timestamp
- error_code

PII 원문 저장 금지.

---

## 16. Conversation Health Monitor 연동

향후 하루 2회 Conversation Health Monitor에서 다음을 탐지할 수 있어야 한다.
- stale client 감지 건수
- update modal 표시 건수
- update 성공/실패
- update gate 우회 시도
- stale-client recovery 실패
- update 이후 Mission resume 실패
- update 이후 Free Chat 진입 실패

---

## 17. DEV Gate

### Case A — 업데이트 없음
PASS:
- modal 0
- 정상 진입

### Case B — 업데이트 있음
PASS:
- 중앙 blocking modal
- `업데이트` 버튼
- 닫기/나중에 없음
- 주요 기능 진입 차단

### Case C — 업데이트 버튼
PASS:
- worker update/activation
- controllerchange
- hard reload
- latest version handshake
- modal 해제

### Case D — 업데이트 안 하고 navigation 시도
PASS:
```text
업데이트를 진행하세요
```
표시 + navigation 차단.

### Case E — Active Mission 중 update 발견
PASS:
- Mission 중단 0
- reload 0
- turn loss 0
- session 유지

### Case F — Active Free Chat 중 update 발견
PASS:
- 대화 중단 0
- reload 0

### Case G — 1시간 경과 후 safe screen 진입
PASS:
- version check 반드시 실행
- update 있을 때만 gate

### Case H — update 실패
PASS:
- 무한 spinner 0
- 다시 업데이트 가능
- 주요 기능 우회 0

### Case I — update 후 Mission resume
PASS:
- 동일 daily Mission
- duplicate session 0
- progress 유지
- reward/event duplicate 0

---

## 18. Production 적용 전 확인

필수:
- TypeScript PASS
- unit PASS
- integration PASS
- production build PASS
- Service Worker lifecycle QA
- iPhone PWA QA
- Android PWA QA 가능 범위
- Mission active-session regression
- Free Chat active-session regression
- version API latency 확인
- update metadata payload 최소화

---

## 19. Production 배포 정책

이번 Request는 오늘 적용 목표다.

단, 다음이 모두 PASS해야 Production 반영 가능:

```text
DEV update gate PASS
Mission session interruption 0
Free Chat session interruption 0
update success PASS
update failure retry PASS
latest version validation PASS
```

Production 반영 후 smoke:
1. 현재 최신 버전 사용자 → modal 없음
2. 의도적으로 stale version fixture → 중앙 update modal
3. update → reload → latest deployment 확인
4. Mission 정상 start/resume
5. Free Chat 정상
6. error/5xx 증가 없음

---

## 20. 금지 사항

- 대화 중 강제 reload 금지
- 업데이트 없음에도 blocking modal 금지
- 업데이트 여부 확인을 위해 전체 asset 선다운로드 금지
- 하단 banner만 띄우고 stale client 무기한 방치 금지
- `나중에` 버튼 제공 금지
- update 완료 전 주요 기능 진입 허용 금지
- Service Worker activation 확인 없이 reload 금지
- update로 Mission 신규 세션 생성 금지
- update로 reward/event 중복 지급 금지
- historical conversation/progress 삭제 금지

---

## 21. 완료 보고서

최종 보고:
1. 기존 PWA update lifecycle
2. 기존 stale-client 위험 지점
3. version Source of Truth
4. 1시간 판단 Source of Truth
5. update check 방식
6. blocking modal 구현
7. navigation gate
8. Service Worker activation 흐름
9. hard reload 흐름
10. latest deployment 검증
11. update failure recovery
12. active conversation defer 동작
13. Mission resume 결과
14. Free Chat regression
15. telemetry 추가
16. DEV E2E
17. Production deployment
18. Production smoke
19. rollback 여부
20. 남은 위험

---

# 최종 완료 정의

> K-Bestie는 사용자가 Mission 또는 Free Chat을 진행 중일 때 업데이트 때문에 대화를 끊지 않는다. 세션이 1시간 이상 경과한 뒤 안전한 초기화면으로 재진입하면 최신 버전 여부만 확인하고, 업데이트가 없으면 정상 진입한다. 업데이트가 있으면 화면 정중앙의 blocking modal에서 `업데이트`를 반드시 수행해야 하며, 업데이트 전에는 주요 기능으로 진입할 수 없다. 업데이트 완료 후 최신 deployment로 reload되고 기존 Mission 데이터와 진행 상태는 안전하게 보존된다.
