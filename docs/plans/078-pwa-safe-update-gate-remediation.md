# 078 PWA Safe Update Gate 반려 보완 설계

## 0. 기준과 불변조건

- 기준 커밋은 `94affe5`, 대상은 `.codex-worktrees/078-pwa-safe-update`의 미커밋 변경이다.
- 제품 코드 수정 전에 아래 네 불변조건을 먼저 테스트 가능한 순수 계약으로 고정한다.
  1. 어떤 탭에서든 Mission/Free Chat 시작·턴 저장·종료 보상 정산이 진행 중이면 어느 탭도 새 worker를 활성화하지 않는다.
  2. `registration.update()` 뒤 `installing -> installed` 전이를 기다리고, 동일 proposal/worker에는 `SKIP_WAITING`을 정확히 한 번만 실행한다.
  3. `controllerchange`는 성공이 아니다. reload 뒤 서버 build와 현재 문서 build와 controller worker build가 모두 일치하는 latest handshake가 성공해야 gate 해제 및 `pwa_update_success` 기록이 가능하다.
  4. 알 수 없는 route, 아직 hydration/readiness가 끝나지 않은 route, 응답하지 않는 탭, 출처·build·nonce가 맞지 않는 SW 메시지는 모두 fail-closed 한다.
- 일반 update gate와 fatal stale-asset recovery는 별도 상태 머신을 유지한다. 다만 둘 다 동일한 worker identity 검증과 post-reload handshake를 사용한다.

## 1. 목표 상태 머신

### 1.1 Gate 상태

```text
BOOTING
  -> CHECKING
     -> CURRENT                         (서버/문서 build 일치, waiting worker 없음)
     -> UPDATE_DEFERRED                 (mismatch/waiting + local/remote hazard)
     -> UPDATE_BLOCKING                 (mismatch/waiting + 명시적 safe route ready)
     -> CHECK_NETWORK_ERROR             (비차단, update로 오판 금지)

UPDATE_BLOCKING --업데이트 클릭--> RECHECKING
RECHECKING
  -> CURRENT                            (no-update + waiting/installing 없음: gate 해제)
  -> UPDATE_BLOCKING_ERROR              (network/invalid response: gate 유지, retry)
  -> REGISTRATION_UPDATING              (mismatch)

REGISTRATION_UPDATING
  -> INSTALLING -> INSTALL_READY        (installing.statechange를 installed까지 bounded wait)
  -> UPDATE_BLOCKING_ERROR              (redundant/timeout/update 실패/no matching worker)

INSTALL_READY -> CONSENSUS_PREPARING
CONSENSUS_PREPARING
  -> UPDATE_DEFERRED                    (어느 탭이든 NACK_ACTIVE/NACK_NOT_READY/timeout)
  -> ACTIVATING                         (모든 실제 window client가 ACK_SAFE)

ACTIVATING -> CONTROLLER_CHANGED -> RELOAD_PENDING -> reload
새 문서 BOOTING + pending marker -> VERIFYING_LATEST
VERIFYING_LATEST
  -> CURRENT                            (server == document == controller build; 그때만 success/gate 해제)
  -> VERIFYING_ERROR                    (network/worker timeout/mismatch; gate 유지, retry)
```

### 1.2 업데이트 클릭의 분기 계약

- `performClientVersionCheck`는 `no-update | mismatch | network-failure | invalid-response`를 구분하고 응답 전체 metadata를 반환한다.
- `no-update`: `registration.waiting`과 설치 중 worker가 모두 없을 때만 기존 mismatch를 취소하고 modal을 닫는다. worker가 있으면 worker build identity를 확인한 뒤 mismatch 경로를 계속한다.
- `network-failure/invalid-response`: `registration.update`, proposal 생성, `SKIP_WAITING`, reload를 모두 금지하고 retry 가능한 blocking error로 남는다.
- `mismatch`: 목표 build를 고정한 뒤 `registration.update()`를 호출한다. `registration.waiting`이 즉시 없으면 `updatefound`와 해당 `installing.statechange`를 먼저 구독하고 `installed`까지 기다린다. `redundant`, install timeout, 목표 build 불일치는 실패다.
- `SKIP_WAITING`은 page가 직접 반복 전송하지 않는다. waiting worker가 합의 성공 후 proposal ID별 `Set` 가드 아래 내부에서 한 번 호출한다.

## 2. 탭 합의 프로토콜

### 2.1 역할과 저장 계약

- 정확성의 기준은 waiting worker의 `clients.matchAll({ type: "window", includeUncontrolled: true })` 결과다. `BroadcastChannel`은 빠른 알림용이며 탭 존재 판정의 기준으로 사용하지 않는다.
- localStorage `k_pwa_activation_proposal_v1`에는 `{ protocol: 1, proposalId, ownerTabId, targetBuild, workerNonce, createdAt, expiresAt }`만 저장한다. CAS를 흉내 내기 위해 기록 직후 다시 읽어 동일 proposal인지 확인하고, 기존 미만료 proposal이 있으면 새 제안을 만들지 않는다.
- 각 탭은 sessionStorage UUID `tabId`를 가진다. proposal의 storage event 또는 `BroadcastChannel("kbestie:pwa-update:v1")` PREPARE를 받는 즉시 `activationBarrier=true`로 전환한다. barrier 동안 Mission/Free Chat 새 start/resume 및 주요 route navigation을 차단한다.
- localStorage proposal은 새로 열린 탭도 첫 mount에서 읽어 barrier에 들어가게 하는 장치다. 최종 투표 대상은 heartbeat 목록이 아니라 SW가 열거한 실제 `WindowClient` ID다.

### 2.2 PREPARE/투표/활성화 순서

1. safe tab이 목표 waiting worker와 MessageChannel identity handshake를 수행해 `{ buildId, workerNonce, echoedRequestNonce }`를 얻는다.
2. 목표 build/nonce가 서버 metadata와 맞으면 localStorage proposal lease를 기록하고 waiting worker에 `PWA_PREPARE_ACTIVATION`을 보낸다.
3. waiting worker는 메시지 source가 동일 origin의 `WindowClient`인지, `targetBuild === BUILD_ID`, `workerNonce === SW_INSTANCE_NONCE`, proposal UUID/만료가 유효한지 검사한다.
4. waiting worker는 `clients.matchAll()`로 실제 client ID 집합을 얻고 각 client에 `PWA_TAB_PREPARE`를 전송한다. 탭은 먼저 barrier를 세운 뒤 현재 snapshot을 다시 읽어 투표한다.
5. ACK 조건은 `explicitSafeRoute && currentRouteReady && hazards.size === 0 && documentBuild가 proposal의 fromBuild와 일치`이다. 그 외는 이유를 붙인 NACK이다. 미응답 2초, 중복 client ID, source가 다른 응답은 NACK이다.
6. 전원 ACK 후 worker가 `clients.matchAll()`을 다시 실행한다. client 집합이 달라졌으면 새 client까지 다시 투표시키고, 같은 집합이 연속 2회 관찰될 때만 commit한다. 이 사이 모든 새 코드 탭은 storage barrier 때문에 start할 수 없고, 구버전 탭은 투표를 못 하므로 timeout으로 activation을 막는다.
7. commit 시 waiting worker가 proposal ID를 `handledProposals`에 넣고 `self.skipWaiting()`을 정확히 한 번 호출한다. NACK/timeout이면 `PWA_ACTIVATION_ABORTED`를 보내고 proposal을 해제한다.
8. 각 탭의 `controllerchange`는 로컬 hazard를 다시 확인한다. 준비된 safe 탭만 reload marker를 기록하고 reload한다. 예기치 않은 controllerchange를 받은 active 탭은 reload하지 않고 `EXTERNAL_CONTROLLER_DEFERRED`로 남아 hazard 종료 후 safe route에서 reload한다.

### 2.3 대화 hazard 범위

- `lib/pwa/conversationActivity.ts`를 boolean store에서 reason 집합 store로 바꾼다. snapshot은 `{ ready, hazards: Record<source, string[]>, isAnyActive }`이며 동일 source의 여러 비동기 작업이 서로 false로 덮어쓰지 않도록 token acquire/release API를 제공한다.
- Mission hazard: entry `checking/starting/resuming`, session active, `answerInFlightRef`, `turnPhaseRef !== idle`, pending turn 저장/POST/reconciliation, completion closing line, reward settlement 및 reward modal 종료 전.
- Free Chat hazard: start/restore in-flight, `connecting/live`, recording/responding/speaking, pending message write 수가 1 이상, `/api/chat/pause` reward settlement, reward modal 종료 전, 종료 후 홈 이동 대기.
- start/resume 핸들러는 비동기 호출 직전에 token을 획득하고 `finally`에서 해제한다. `Set<Promise>`처럼 React snapshot에 반영되지 않는 ref는 pending count state/token과 함께 갱신한다.
- route component가 아직 snapshot을 publish하지 않은 상태는 `ready=false`로 NACK한다. critical route를 inactive라고 추정해 modal을 띄우지 않는다.

## 3. Safe route와 navigation lock

- prefix 기본 허용과 unknown=true를 제거한다. 078 1차 allowlist는 정확히 `/`, `/child/home`, `/parent`, `/parent/home`, `/login`, `/offline`만 허용한다. 폼/설정/온보딩/초대/Play/Mission/Chat/알 수 없는 route는 모두 unsafe다.
- `currentRouteReady`는 `(a) allowlist exact match, (b) `usePathname()` route revision이 check 시작 때와 동일, (c) 해당 revision의 React commit 후 readiness effect 완료, (d) activity store ready, (e) navigation in-flight 없음`을 모두 만족해야 true다.
- pathname 변경 즉시 ready=false, 열린 proposal은 abort한다. version check 응답이 돌아올 때 checked route/revision이 현재와 다르면 결과를 버린다.
- modal open 시 현재 URL과 gate token으로 history sentinel을 만든다. capture click뿐 아니라 `popstate`, `submit`, `beforeunload`를 막는다. browser back은 동일 URL sentinel을 즉시 복구하고 “업데이트를 진행해 주세요.”를 표시한다. gate 해제 시 sentinel 제거 절차를 별도 함수로 수행하며, 다른 URL로 이동시키지 않는다.
- programmatic pathname 변경이 감지되면 새 route를 ready로 인정하지 않고 gate를 유지한다. 주요 기능 start/resume는 `activationBarrier`/gate store를 직접 확인하므로 click 우회만으로 진입할 수 없다.

## 4. Worker 메시지 및 latest handshake 보안 계약

- `app/api/pwa/sw/route.ts`가 생성하는 worker는 시작 시 `crypto.randomUUID()` 기반 `SW_INSTANCE_NONCE`를 만든다.
- 모든 메시지는 versioned envelope `{ protocol: 1, type, requestNonce, proposalId?, targetBuild?, workerNonce? }`를 사용한다.
- worker는 `event.source`가 존재하는 same-origin `WindowClient`인지 검사한다. client는 SW message에서 `event.source === navigator.serviceWorker.controller` 또는 사전에 MessageChannel로 identity를 얻은 정확한 waiting worker인지 검사한다.
- `GET_VERSION`/`PWA_GET_IDENTITY` 응답은 request nonce를 echo하고 `buildId`, `swVersion`, `workerNonce`를 반환한다. client는 echo/build/nonce가 모두 맞아야 이후 메시지를 신뢰한다.
- `K_STALE_ASSET`는 `{ protocol, buildId, workerNonce, requestNonce, pathname, status: 404 }`를 포함한다. `StaleClientRecovery`는 controller source, controller handshake build/nonce, same-origin `/_next/static/` pathname, 404를 모두 확인한 경우만 복구한다. 임의 page/SW message의 type 문자열만으로 reload하지 않는다.
- reload 전 sessionStorage `k_pwa_reload_pending_v1`에 `{ proposalId, targetBuild, targetDeploymentId, successEventId, startedAt }`를 기록한다. reload 후 modal/gate는 `VERIFYING_LATEST`로 시작한다.
- latest 성공 조건은 `/api/client-version` no-store 응답의 `buildId/buildStamp/swVersion`과 현재 `BUILD_STAMP`, 현재 controller identity의 `buildId`가 모두 동일하고, 응답 nonce/shape가 유효한 경우다. deployment ID는 pre-reload target과 동일하거나 더 최신 build로 명시 재평가된 경우만 허용한다.
- controllerchange 직후 `pwa_update_success`를 기록하거나 modal을 닫지 않는다. handshake 실패/네트워크 오류는 pending marker와 gate를 유지하고 retry만 제공한다.

## 5. API/telemetry 보안 계약

- `POST /api/analytics/pwa-update` body는 4KB 이하, `application/json`만 허용한다. 필수 필드는 `event_id` UUID, `event_type`, `correlation_id` UUID, `route`; 선택 필드는 길이 제한된 `current_version/latest_version/error_code/metadata`다. unknown top-level/metadata key, nested metadata, NaN/Infinity, query/hash/control-char route는 400이다.
- metadata는 enum/범위를 함께 검증한다. 예: `phase`/`reason`/`trigger`는 정해진 enum, `retry_count/attempt`는 0~10 정수, `check_interval_ms`는 0~86,400,000 정수, `sw_state`는 ServiceWorkerState enum이다.
- identity는 `resolveAppSessionActor(user.id)` 결과만 사용한다. client가 `user_id/actor_id/child_id/family_id/actor_type/session_id`를 보내면 400이다.
- Dev 실배포 스키마에는 `behavior_events.event_key`와 `behavior_events_event_key_uq`가 없으므로 이를 조회하거나 074 migration을 적용하지 않는다. 새 migration도 추가하지 않는다.
- 멱등성은 현재 존재하는 `behavior_events.id UUID PRIMARY KEY`를 사용한다. 서버가 인증 actor ID와 client `event_id`를 domain-separated SHA-256(`kbestie:pwa-update:v1\0<actorId>\0<eventId>`)으로 해시하고 앞 16바이트의 version/variant bit를 UUIDv8/RFC4122 형태로 맞춘 `behaviorEventId`를 만든다. 같은 actor+event는 항상 같은 PK, actor나 event가 다르면 다른 PK다. client가 DB ID를 직접 지정할 수 없다.
- 처리 순서는 `strict body 검증 -> auth/actor 확정 -> deterministic PK 계산 -> PK 기존행 조회 -> 신규 요청 rate limit -> insert`다. 기존행이 actor/event/type까지 일치하면 rate limit보다 먼저 `{ ok: true, duplicate: true }`를 반환한다. 신규 insert의 23505는 행을 다시 읽어 actor ID, event name, server가 properties에 기록한 `client_event_id`가 모두 일치할 때만 duplicate 200이며, 다르면 `id_collision` 409로 취급한다.
- rate limit은 인증 후 actor 단위 60건/분(DB의 `behavior_events` 최근 pwa event count)과 instance burst 10건/10초를 함께 적용한다. 두 제한 모두 deterministic PK별 신규 시도에만 적용하고, 기존 duplicate는 소비하지 않는다. 429 경로는 insert를 호출하지 않으며 Map은 주기적으로 만료 entry를 삭제한다.
- `lib/analytics/logBehaviorEvent.ts`는 선택적 server-only `id`를 payload의 `id`로 넣고 insert 결과를 `inserted | duplicate | failed`로 반환하도록 확장한다. 기존 호출자는 `id`를 넘기지 않고 반환값을 무시하므로 동작이 바뀌지 않는다. PWA route만 deterministic ID와 `client_event_id` property를 넘긴다.
- legacy `POST /api/client-version`은 strict body allowlist/2KB/rate limit을 적용하고 `childId`를 더 이상 받지 않는다. `resolveAppSessionActor`로 child ID를 서버에서 확정하고, 전달된 UUID `sessionId`가 `chat_sessions.id`이며 그 `child_id`가 actor child와 일치하는지 확인한다. `clientSha/swVersion`은 64자 제한 문자열만 허용한다. 불일치 session은 403, malformed는 400, DB 실패는 500으로 반환한다.
- `app/chat/page.tsx`와 `app/child/missions/page.tsx`의 legacy POST payload에서 `childId`를 제거하고 서버 검증 가능한 session/build/SW identity만 전송한다.

## 6. 파일별 변경 지시

- `lib/pwa/updateGate.ts`: exact safe allowlist, route revision/readiness 판정, richer version result/metadata validator, unknown route fail-closed.
- `lib/pwa/updateFlow.ts`: 위 상태/transition reducer, registration update 후 installed bounded wait, proposal별 one-shot activation helper, reload pending/handshake 판정 pure helper.
- `lib/pwa/conversationActivity.ts`: ready + tokenized hazard registry, activation barrier 조회/구독 계약.
- `lib/pwa/tabUpdateConsensus.ts`(신규): proposal storage schema/CAS/expiry, BroadcastChannel hint, message envelope/type guard, tab vote 계산.
- `app/api/pwa/sw/route.ts`: worker identity nonce, waiting-worker client enumeration/2-pass consensus, source/build/nonce 검증, one-shot skipWaiting, authenticated stale message envelope.
- `components/PwaServiceWorker.tsx`: reducer 기반 orchestration, no-update/network/mismatch 분기, installing wait, consensus 호출, hazard-aware controllerchange, reload marker, post-reload latest handshake, route readiness 및 history lock 연결.
- `components/PwaUpdateGateModal.tsx`: `verifying/error/deferred` copy와 retry, navigation lock 경고 표시; modal 자체는 단일 update/retry 버튼 유지.
- `components/StaleClientRecovery.tsx`, `lib/pwa/staleClientRecovery.ts`: controller/waiting identity helper 재사용, stale message envelope 검증, recovery success를 post-reload handshake 뒤로 이동.
- `app/chat/page.tsx`: Free Chat start/restore/turn write/reward settlement hazard token, barrier start guard, legacy client-version payload 축소.
- `app/child/missions/page.tsx`: Mission start/resume/turn persistence/reconciliation/completion/reward hazard token, barrier start guard, legacy client-version payload 축소.
- `lib/pwa/updateTelemetry.ts`: event ID, strict client-side body normalization, reload을 넘는 success event ID 재사용.
- `lib/analytics/deterministicEventId.ts`(신규) 및 test: actor+client event ID에서 UUIDv8 deterministic PK 생성, domain separation과 UUID bit/format 검증.
- `app/api/analytics/pwa-update/route.ts`, `lib/analytics/logBehaviorEvent.ts`: strict schema, actor identity, duplicate-first 조회, DB+burst rate limit, 기존 UUID PK 기반 atomic idempotency, 정확한 status.
- `app/api/client-version/route.ts`: GET metadata shape 검증 가능 계약 유지, POST identity/ownership/size/rate-limit 보강.
- 각 대응 테스트 파일과 `e2e/qa-078-pwa-safe-update.spec.ts`, `package.json`: 아래 완료조건을 실행 경로에 포함.

## 7. 10분 단위 agy 수정 분할

### U1 — 순수 상태 머신·route/handshake 계약 (순차, 10분 이내)

- 대상: `lib/pwa/updateGate.ts`, `lib/pwa/updateFlow.ts`, `lib/pwa/updateGate.test.ts`, `lib/pwa/updateFlow.test.ts`.
- 작업: exact allowlist, route revision/readiness, recheck 4분기, installing->installed wait, one-shot transition, reload pending/latest handshake pure reducer를 구현한다.
- 완료: no-update가 gate를 해제하는 조건, network가 activation을 시작하지 않는 조건, mismatch/install timeout/redundant, success-before-handshake 금지를 unit test로 증명한다.

### U2 — SW identity·cross-tab 합의 (U1 후, 10분 이내)

- 대상: `lib/pwa/tabUpdateConsensus.ts`(신규), 대응 test(신규), `app/api/pwa/sw/route.ts`, `app/api/pwa/sw/route.test.ts`.
- 작업: storage proposal/BC hint, versioned envelope guard, waiting worker의 client enumeration·전원투표·2-pass 안정화·one-shot skipWaiting, stale envelope를 구현한다.
- 완료: 2탭 중 active/NACK/무응답/구버전 탭이면 skipWaiting 0회, 전원 safe면 1회, 새 client가 중간 등장하면 재투표, source/build/nonce mismatch면 무시하는 test가 통과한다.

### U3 — PWA orchestrator·modal·navigation/reload 검증 (U1·U2 후, 10분 이내)

- 대상: `components/PwaServiceWorker.tsx`, `components/PwaUpdateGateModal.tsx`, `components/PwaUpdateGateModal.test.tsx`, PwaServiceWorker integration test(신규), `components/StaleClientRecovery.tsx`, `lib/pwa/staleClientRecovery.ts` 및 test.
- 작업: reducer orchestration, registration installed wait, consensus, hazard-aware controllerchange, history sentinel/back guard, reload pending 및 latest handshake, stale message source 검증을 연결한다.
- 완료: controllerchange만으로 success/modal close 0회, post-reload triple match 뒤에만 1회 success, back/Escape/outside/programmatic route change가 gate를 우회하지 못하고, active tab controllerchange reload 0회를 component test로 증명한다.

### U4 — 대화 hazard와 API 보안 (U3 후, 10분 이내)

- 대상: `lib/pwa/conversationActivity.ts` 및 test, `app/chat/page.tsx`, `app/child/missions/page.tsx`, `lib/pwa/updateTelemetry.ts` 및 test, `lib/analytics/deterministicEventId.ts` 및 test(신규), `app/api/analytics/pwa-update/route.ts` 및 test, `lib/analytics/logBehaviorEvent.ts`, `app/api/client-version/route.ts` 및 test.
- 작업: tokenized hazard, start barrier, pending write/turn/reward 정산 범위, telemetry strict schema, actor+event deterministic behavior UUID, duplicate-first/rate-limit/insert 순서, legacy POST actor/session ownership을 구현한다. `event_key` 접근과 migration은 금지한다.
- 완료: 비동기 token 중 하나라도 남으면 inactive 전환 불가, start 직전 proposal race 차단, 같은 actor+event가 동일한 유효 UUID를 만들고 다른 actor/event는 다른 UUID를 만드는 unit test, duplicate preflight가 rate limit을 소비하지 않는 test, 동시 insert 23505 재조회가 1행/200을 보장하는 test, 충돌행 불일치 409, 신규 초과 429·insert 0회, spoofed child/session 400/403을 증명한다.

### U5 — 회귀·E2E fixture 보강 (U4 후, 10분 이내)

- 대상: `e2e/qa-078-pwa-safe-update.spec.ts`(신규), `package.json`, 누락된 PWA test script 항목.
- 작업: two-context Playwright fixture로 실제 2탭 합의와 lifecycle을 검증하고 모든 신규 unit/API/component test가 `test:pwa-update`에 포함되게 한다.
- 완료: 아래 8개 E2E가 모두 PASS하고 기존 Mission real-repro/Free Chat 보상 회귀가 PASS한다. QA 워커는 제품 코드를 수정하지 않는다.

## 8. 테스트 및 E2E 완료조건

1. update click 직후 `registration.update()`가 새 installing worker를 만들면 installed까지 기다린 후에만 합의를 시작한다. 설치 timeout/redundant는 retry error, SKIP_WAITING 0회다.
2. recheck no-update/network/mismatch가 각각 gate 해제/오류 유지/activation 준비로 정확히 분기한다.
3. 탭 A safe, 탭 B active Mission 또는 Free Chat이면 A의 update click 후 B reload 0, controllerchange 0, turn/pending write/reward 손실 0이다.
4. 탭 B가 active를 끝내고 safe route ready가 된 뒤 새 proposal에서만 전원 ACK, SKIP_WAITING 1, safe 탭 reload가 발생한다.
5. controllerchange가 발생해도 `pwa_update_success`와 gate 해제는 0이며, reload 후 server/document/controller build triple match 뒤 각각 정확히 1회다. handshake 5xx/mismatch면 gate 유지와 retry가 보인다.
6. unknown route, `/parent/settings`, `/onboarding`, Mission/Chat/Play, hydration 전 safe route는 modal/activation 대상이 아니다. exact allowlist route ready일 때만 modal이 열린다.
7. modal에서 browser back, Escape, outside click, link/submit을 시도해도 route가 바뀌지 않고 한국어 경고가 보인다.
8. forged `K_STALE_ASSET`, 잘못된 source/build/nonce/proposal, 다른 worker의 늦은 메시지는 reload/성공/telemetry를 만들지 않는다.
9. telemetry duplicate event ID는 DB 1행과 idempotent 200, rate-limit 초과 신규 event는 429, metadata/body/route 위반은 400이다. legacy client-version POST의 다른 child/session은 기록되지 않는다.
10. Mission start/resume/turn persistence/reconciliation/completion/reward 및 Free Chat start/turn write/pause reward 중 각 단계에서 proposal이 들어오면 NACK되고, settlement 종료 전에는 active가 false가 되지 않는다.

## 9. 병렬성·위험·승인

- U1 -> U2 -> U3 -> U4 -> U5 순차다. 핵심 파일과 계약이 겹치므로 구현 병렬화하지 않는다.
- cross-tab lifecycle과 인증/DB telemetry는 `[복잡]` 정적 리뷰 대상으로 Codex Sol 별도 세션에 올리고, 통과 뒤 별도 agy E2E QA를 수행한다.
- Dev 현재 스키마의 `behavior_events.id UUID PRIMARY KEY`만 재사용한다. 074의 `event_key` migration을 적용하지 않고 078 migration도 추가하지 않는다. legacy `client_version_events` 스키마도 바꾸지 않는다.
- deterministic PK insert는 DB PK가 보장하므로 다중 instance에서도 멱등성이 원자적이다. 반면 현재 스키마만으로 `최근 count -> insert` rate limit 자체를 전역 원자화할 수는 없다. actor DB rolling count + instance burst를 방어선으로 사용하되 경계 시점의 소수 초과 가능성은 잔여 위험으로 기록한다. 엄격한 전역 quota가 필요하면 별도 승인된 RPC/migration 작업으로 분리한다.
- iOS standalone 환경에서 BroadcastChannel 전달이 지연돼도 correctness는 waiting worker client enumeration과 storage barrier에 의존한다. 미응답은 업데이트 지연으로 귀결되며 active 대화 중단보다 안전하다.
- Production 배포와 Production smoke는 대표 명시 승인 전 수행하지 않는다.

## 10. 미해결 질문

- 없음. 1차 safe allowlist는 보수적으로 6개 route만 허용하고, 추가 route는 별도 QA 후 명시적으로만 늘린다.

## 11. 2차 최종 정적 리뷰 반려 교정 원칙

U1~U5 구현 결과는 최종 정적 리뷰를 통과하지 못했으므로 완료로 간주하지 않는다. 아래 U6, U7은 기존 구현 위에 덧붙이는 선택적 개선이 아니라 반려 사유를 제거하는 순차 교정 단계다. U6의 protocol/state 계약과 unit/component test가 먼저 통과한 뒤에만 U7의 API/E2E를 진행한다. U6와 U7 내부의 `a/b/c`는 각각 agy 10분 이내 실행 단위이며 동일 파일을 건드리므로 표기 순서대로 수행한다.

### 11.1 불변 안전 규칙

- 같은 build 설정으로 생성한 `/sw.js` 응답 body는 요청 시각과 횟수에 관계없이 byte-for-byte 동일해야 한다. `SW_INSTANCE_NONCE`는 route handler의 `crypto.randomUUID()` 결과를 문자열에 삽입하지 않고, 고정된 worker script 안의 `const SW_INSTANCE_NONCE = crypto.randomUUID();`로 worker global이 실제 실행될 때 생성한다. 이 nonce는 실행 인스턴스의 메시지 상관관계에만 쓰며 배포/스크립트의 영속 identity로 사용하지 않는다.
- 페이지가 임의로 만든 tab UUID는 `WindowClient.id`가 아니다. 페이지는 client ID를 주장하지 않는다. waiting worker는 매 합의 pass마다 `clients.matchAll({ type: "window", includeUncontrolled: true })`로 얻은 실제 `WindowClient.id`에 고유 `voteNonce`를 묶어 보관하고, 응답의 실제 identity는 오직 `ExtendableMessageEvent.source.id`에서 얻는다.
- activation 대상은 `registration.update()` 뒤 확정한 정확한 `registration.waiting` 객체 하나다. 대상 객체, normalized `scriptURL`, `state === "installed"`, MessageChannel identity의 `buildId/swVersion/workerNonce`를 proposal에 고정하며, 모든 `await` 뒤 `registration.waiting === targetWorker`를 재확인한다. 교체되거나 `redundant`가 된 worker, 다른 worker에서 늦게 온 message, 단순히 build 문자열만 같은 worker는 activation할 수 없다.
- 전역 barrier는 modal의 ref가 아니라 동일 origin 모든 탭에서 보이는 proposal lifecycle과 각 탭의 동기 snapshot을 결합한다. start와 barrier의 레이스는 `tryAcquireConversationHazard(reason)` 한 동기 임계구역으로 닫는다. barrier가 먼저면 start가 실패하고, start token이 먼저면 해당 탭이 NACK한다. 둘 다 ACK 후 start가 새로 시작되는 경우는 없다.
- `controllerchange`는 성공 조건이 아니다. reload 전 marker를 완전하게 기록하고 reload 후 latest server/document/controller handshake가 성공하기 전에는 gate 해제, marker 삭제, `pwa_update_success` 및 `pwa_stale_client_recovery_success` 전송을 모두 금지한다.
- 현재 Dev schema만 사용한다. `behavior_events.event_key`를 조회하거나 074 migration을 적용하거나 078 migration을 추가하지 않는다. 서버 deterministic UUID와 기존 `behavior_events.id UUID PRIMARY KEY`만 atomic idempotency 경계로 사용한다.
- 078 범위의 product/test/SW 문자열에 `Promise.all(`을 남기지 않는다. 독립 작업 병렬 수집이 필요한 곳은 결과별 실패를 명시적으로 검사하는 `Promise.allSettled`만 사용한다.

## 12. U6 — SW identity·전역 barrier·reload protocol 교정

### U6-a — 안정된 worker script와 실제 WindowClient 투표 계약 (순차 1, 10분 이내)

- 대상 파일:
  - `lib/pwa/renderServiceWorker.ts`(신규)
  - `lib/pwa/swProtocol.ts`(신규)
  - `lib/pwa/swProtocol.test.ts`(신규)
  - `app/api/pwa/sw/route.ts`
  - `app/api/pwa/sw/route.test.ts`
  - `lib/pwa/tabUpdateConsensus.ts`
  - `lib/pwa/tabUpdateConsensus.test.ts`
- 정확한 변경:
  1. SW 문자열 생성을 `renderServiceWorker({ buildId, buildStamp, swVersion, cacheAssets })`라는 side-effect 없는 server-only 함수로 분리한다. production route는 build 상수만 전달하며 request/query/header/env로 target build를 바꾸는 분기를 두지 않는다. runtime nonce 생성문은 생성된 script 안에 그대로 남기고 route 실행 중 난수는 만들지 않는다.
  2. install precache와 activate cache cleanup은 `Promise.allSettled`를 쓰고 각 rejected 결과를 검사한다. 필수 shell asset 하나라도 precache 실패하면 install을 reject하고, cache cleanup 실패는 명시 로그 후 activate를 reject하거나 정해진 fail-closed 상태로 둔다. `Promise.all`은 route 원본과 생성 문자열 모두 0건이어야 한다.
  3. 새 공통 protocol은 `protocolVersion`, `type`, `proposalId`, `passId`, `voteNonce`, `targetBuild`, `targetSwVersion`, `workerNonce`, `expiresAt`를 strict-parse한다. unknown key/type, 만료, target mismatch는 NACK 또는 무시하며 loose cast로 받지 않는다.
  4. waiting SW는 pass 1 시작 때 client set을 읽고 client마다 별도 `voteNonce`를 발급한다. `PWA_TAB_PREPARE`에는 client ID를 싣지 않는다. `PWA_TAB_ACK/NACK`도 client ID를 받지 않으며 SW가 `event.source instanceof WindowClient`와 `event.source.id`로 실제 sender를 구하고, 해당 pass/client에 발급했던 nonce와 정확히 일치할 때만 첫 표를 기록한다. 재사용 nonce, 다른 client의 nonce, 중복 응답, 이전 pass 응답은 거절한다.
  5. pass 1 전원 ACK 후 client set을 다시 열거한다. set이 달라지면 새로운 pass 1부터 재시작한다. 같으면 fresh `passId/voteNonce`로 pass 2를 수행하고, 두 번째 set도 같고 전원 ACK일 때 proposal별 `self.skipWaiting()`을 정확히 한 번만 호출한다. timeout, NACK, client 소실/추가, source mismatch는 abort이며 SKIP_WAITING 0회다.
  6. page→waiting activation 요청은 exact waiting worker에 연 MessageChannel로 보내고 결과도 그 private port로만 받는다. 전역 `navigator.serviceWorker.message`의 `PWA_ACTIVATION_COMMITTED/ABORTED`는 UI 상태 전환 권한이 없다. waiting worker는 요청 source도 실제 WindowClient인지 검사한다.
  7. 현재 worker는 신규 `PWA_GET_IDENTITY`와 기존 `GET_VERSION` 둘 다 응답한다. `requestServiceWorkerIdentity(worker)`는 신규 요청을 먼저 시도하고 timeout 때 legacy `GET_VERSION`으로 read-only fallback한다. legacy identity에는 `protocolVersion: 0`, `workerNonce: null`을 표시하고 stale 탐지 보조에만 사용한다. waiting activation, proposal 생성, success handshake는 protocol v1 identity만 허용한다.
- 완료 test:
  - 동일 renderer 입력 및 route GET 2회의 body/hash가 완전히 같고, 두 다른 worker runtime 평가에서 nonce만 서로 다르다.
  - 응답 script에 route 실행 시 생성된 UUID literal이 없고 runtime 생성문이 정확히 한 번 있다.
  - 실제 client A의 nonce를 B가 제출, 주장 `clientId` 삽입, 이전 pass nonce 재사용, exact waiting이 아닌 worker message, waiting 교체/redundant 각각 SKIP_WAITING 0회다.
  - 2-pass 사이 client 추가/제거는 재투표, 안정된 전원 ACK만 SKIP_WAITING 1회다.
  - `GET_VERSION` legacy fallback은 stale read-only 결과를 반환하지만 activation API는 이를 거절한다.

### U6-b — 전역 barrier, 실제 route readiness와 안전한 check scheduler (순차 2, 10분 이내)

- 대상 파일:
  - `lib/pwa/conversationActivity.ts`
  - `lib/pwa/conversationActivity.test.ts`
  - `lib/pwa/tabUpdateConsensus.ts`
  - `lib/pwa/tabUpdateConsensus.test.ts`
  - `lib/pwa/routeReadiness.ts`(신규)
  - `lib/pwa/routeReadiness.test.ts`(신규)
  - `components/pwa/PwaSafeRouteReady.tsx`(신규)
  - `app/page.tsx`
  - `app/child/home/page.tsx`
  - `app/parent/page.tsx`
  - `app/parent/home/page.tsx`
  - `app/login/page.tsx`
  - `app/offline/page.tsx`
  - `app/chat/page.tsx`
  - `app/child/missions/page.tsx`
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
- 정확한 변경:
  1. barrier singleton은 `{ proposalId, targetBuild, phase: "preparing" | "committed", expiresAt }`와 per-tab `resolvedProposalIds`를 관리한다. 최초 subscriber mount 때 localStorage를 strict-parse해 유효 proposal이면 즉시 barrier를 세우고 expiry timer를 예약한다. storage/BC/SW PREPARE 수신은 같은 proposal을 idempotent하게 open하고, ABORT·storage remove·replacement·expiry는 정확히 같은 proposal만 clear한다. COMMIT은 clear하지 않고 `committed`로 올려 reload/handshake까지 start를 막는다. listener unmount는 구독만 제거하며 살아 있는 proposal을 임의 clear하지 않는다.
  2. owner는 waiting worker에 prepare를 보내기 전에 storage write→read-back 성공과 자기 탭 barrier open을 끝낸다. 수신 탭은 `PWA_TAB_PREPARE`를 받자마자 barrier를 동기 open한 뒤 hazard/readiness snapshot을 읽고 ACK/NACK한다. `tryAcquireConversationHazard`는 barrier 확인과 token 등록 사이에 `await`가 없는 단일 함수다. 이 순서로 barrier-before-start와 start-before-barrier 모두 안전하게 결정한다.
  3. `/`, `/child/home`, `/parent/home`, `/login`, `/offline`만 실제 ready 선언을 할 수 있다. redirect-only `/parent`는 allowlist에 있더라도 `PwaSafeRouteReady`를 mount하지 않아 readiness=false를 유지하거나 allowlist에서 제거한다. 나머지 route는 prefix 추론 없이 항상 unsafe다. 각 safe client page가 `PwaSafeRouteReady(expectedPath)`를 렌더하고, mount commit 뒤 현재 pathname/revision 일치 시 ready token을 발행하며 unmount/path change 시작 즉시 철회한다. `isReactReady: true` 같은 상수 전달은 모두 제거한다.
  4. navigation state는 capture 단계의 same-origin link/submit, `popstate`, `pagehide`, pathname revision 변화에서 즉시 `inFlight=true`가 되고, 새 route의 explicit ready token이 발행돼야만 false가 된다. activity registry의 `ready`와 hazard set도 실제 snapshot을 사용한다.
  5. 모든 자동 check는 단일 `maybeScheduleSafeCheck(trigger, routeRevision)`로 모은다. 호출 source는 mount-ready, route-ready, `visibilitychange` visible, `online`, 60분 timer, manual retry뿐이다. 실행 직전과 version 응답 뒤에 exact safe path, 같은 route revision, route ready, activity ready, hazards=0, navigation=false, barrier=false, in-flight check 없음, throttle 조건을 다시 검사한다. unsafe route의 60초/visibility/online check와 mount 때 놓친 route-ready check는 각각 금지/보장한다.
  6. modal/gate open 시 `originalUrl = pathname + search + hash`, 기존 history state와 unique gate token을 저장한다. base와 sentinel을 같은 `originalUrl`로 만들고 back 시 현재의 이전 URL을 다시 push하지 말고 `history.forward()`로 sentinel을 복원한다. cleanup은 자기 token sentinel만 제거하고 원래 state/URL을 복구한다. pathname이 token의 originalUrl과 달라지면 ready를 false로 유지하고 `router.replace(originalUrl)`한 뒤 원래 route commit 전에는 check/activation하지 않는다.
- 완료 test:
  - mount 전 존재 proposal, storage/BC PREPARE, duplicate PREPARE, ABORT, COMMIT, storage remove, replacement, expiry, listener unmount/remount 전 lifecycle이 deterministic하며 stale timer가 새 proposal을 clear하지 않는다.
  - barrier와 start를 양 순서로 같은 tick에서 실행해도 `(barrier active && new hazard started)` 상태가 한 번도 나오지 않는다. ACK 뒤 barrier가 유지돼 start가 거절된다.
  - safe path이나 readiness 미발행, redirect `/parent`, pathname revision mismatch, navigation in-flight, activity not-ready는 모두 NACK/check 0회다.
  - unsafe route에서 timer/visible/online은 network check 0회, safe route가 늦게 ready가 되면 정확히 1회, 같은 trigger 중첩은 1회다.
  - gate의 원래 URL이 `/child/home?x=1#top`일 때 back/programmatic navigation 뒤 그 URL로 복귀하며 이전 history URL을 잠그지 않는다.

### U6-c — exact waiting target, 완전한 marker와 공통 stale recovery (순차 3, 10분 이내)

- 대상 파일:
  - `lib/pwa/updateFlow.ts`
  - `lib/pwa/updateFlow.test.ts`
  - `lib/pwa/swProtocol.ts`
  - `lib/pwa/staleClientRecovery.ts`
  - `lib/pwa/staleClientRecovery.test.ts`
  - `lib/pwa/recoveryCoordinator.ts`(신규)
  - `lib/pwa/recoveryCoordinator.test.ts`(신규)
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
  - `components/StaleClientRecovery.tsx`
- 정확한 변경:
  1. `registration.update()` 결과는 `no-update | installed-target | network-error | install-timeout | redundant | target-replaced | identity-mismatch`로 명시한다. `installing -> installed`가 돼도 `registration.waiting === installingTarget` 및 exact script/identity 재확인 전에는 합의를 시작하지 않는다. update error를 삼키지 않는다.
  2. marker schema v2의 모든 필드는 필수다: `{ schemaVersion, proposalId, targetBuildId, targetBuildStamp, targetDeploymentId, targetSwVersion, targetScriptUrl, activationWorkerNonce, successEventId, startedAt, expiresAt, reason }`. UUID/문자열/URL/시간/TTL을 strict-parse하며 `prop_${Date.now()}`나 `verify_${Date.now()}` 같은 가짜 ID fallback을 금지한다. marker 저장 실패 시 reload하지 않는다.
  3. runtime `activationWorkerNonce`는 live activation source를 감사·상관시키지만 worker process 재시작 시 바뀔 수 있으므로 영속 배포 일치의 단독 조건으로 쓰지 않는다. post-reload durable identity는 marker의 target build/buildStamp/deployment/swVersion/scriptURL과 fresh controller MessageChannel identity다. nonce가 유지된 경우에는 일치해야 하며, 바뀐 경우 fresh v1 handshake와 durable identity 전체 일치로 새 runtime instance임을 확인한다.
  4. post-reload는 먼저 marker를 읽고 `VERIFYING_LATEST` gate를 복원한다. no-store `/api/client-version`의 `buildId/buildStamp/deploymentId/swVersion`, 현재 document build stamp, exact current controller의 fresh v1 `buildId/swVersion/scriptURL`이 marker target 전체와 같아야 성공한다. server가 더 최신이면 marker를 조용히 성공 처리하지 않고 새 target mismatch gate로 전환한다. 5xx, malformed, controller 없음/legacy, target mismatch는 marker/gate 유지와 retry다.
  5. `successEventId`는 marker 생성 때 한 번 만들고 reload 뒤 성공 telemetry에 그대로 사용한다. DB duplicate 200도 성공 전송 완료로 취급하되 local marker/gate 삭제는 telemetry 응답에 의존하지 않고 handshake 성공 transition에서 정확히 한 번 수행한다. controllerchange 직후 success는 0회다.
  6. `StaleClientRecovery`는 별도 update/reload 구현을 제거하고 검증된 stale signal을 `recoveryCoordinator`에 전달한다. coordinator의 단일 PwaServiceWorker orchestrator가 같은 update→exact waiting→consensus→full marker→reload→latest handshake 흐름을 실행한다.
  7. 신규 stale envelope는 `event.source === navigator.serviceWorker.controller`, strict v1 build/swVersion/runtime nonce, same-origin `/_next/static/` 404를 모두 요구한다. 한 릴리스 호환용 legacy `{ type: "K_STALE_ASSET" }`는 exact current controller source이며 shared `GET_VERSION` fallback이 성공할 때만 fatal recovery 신호로 인정한다. legacy path는 activation/success를 직접 승인하지 못한다. unknown source/message는 무시한다.
- 완료 test:
  - installing A가 installed 된 직후 waiting B로 교체, exact worker가 redundant, 동일 build의 다른 script/nonce인 경우 activation 0회다.
  - marker의 deployment/swVersion/scriptURL/successEventId 누락·위조·만료는 strict reject이며 reload 0회다.
  - controllerchange 후 success 0회, reload 뒤 target deployment/buildStamp/swVersion/controller identity 전체 일치에서 marker의 동일 event ID로 success 1회다. 어느 한 필드 mismatch/5xx/malformed/legacy controller면 gate 유지다.
  - 신규와 legacy stale 입력 모두 공통 coordinator를 타고, legacy는 exact controller+GET_VERSION일 때만 recovery 시작한다. forged source/nonce/path/status는 update/reload/telemetry 0회다.

## 13. U7 — telemetry/API fail-closed와 실제 Dev-app E2E 교정

### U7-a — strict API 계약과 비어 있지 않은 회귀 test (U6 후 순차 4, 10분 이내)

- 대상 파일:
  - `lib/pwa/updateTelemetry.ts`
  - `lib/pwa/updateTelemetry.test.ts`
  - `app/api/analytics/pwa-update/route.ts`
  - `app/api/analytics/pwa-update/route.test.ts`
  - `lib/analytics/deterministicEventId.ts`
  - `lib/analytics/deterministicEventId.test.ts`
  - `lib/analytics/logBehaviorEvent.ts`
  - `app/api/client-version/route.ts`
  - `app/api/client-version/route.test.ts`
  - `app/api/pwa/sw/route.test.ts`
  - `e2e/qa-081-pwa-safe-update.spec.ts`
  - `package.json`
- 정확한 변경:
  1. client/server가 하나의 상수 계약을 공유한다. `sw_state`, `trigger`, `reason`, `phase`, `stale_signature`, `recovery_action`, `error_code`는 각각 명시된 string enum만 허용한다. `retry_count/attempt`는 0~10 정수, `check_interval_ms`는 0~86,400,000 정수다. enum key에 number/boolean, numeric key에 string/boolean, unknown metadata key, nested value는 400이다. client sanitizer도 잘라서 다른 의미로 바꾸지 말고 invalid enum을 버리며 server가 최종 거부한다.
  2. route는 ASCII absolute path만 허용하고 `//`, backslash, query/hash, control/space, absolute/protocol-like URL, dot segment, `%3f/%23/%0a/%2f/%5c` 등 percent-encoded delimiter/control을 거부한다. raw route를 로그/DB에 넣기 전에 canonical 검사를 끝낸다.
  3. telemetry와 client-version POST의 base media type을 `content-type.split(";", 1)[0].trim().toLowerCase()`로 정확히 비교한다. `application/json`과 선택적 charset만 허용하고 `text/application/json`, `application/jsonx`는 415다. stream을 Content-Length와 무관하게 읽어 telemetry 4KB/client-version 2KB 초과 즉시 reader cancel 후 413, malformed/shape는 400으로 고정한다.
  4. telemetry DB 순서는 strict body→auth/actor→deterministic PK→existing lookup→DB rolling count→instance burst→insert다. existing lookup error, rate count error, 23505 재조회 error, log/insert unknown failure는 모두 500 fail-closed이며 신규 insert를 계속하지 않는다. duplicate row는 actor/event/client_event_id까지 일치할 때만 rate-limit보다 먼저 200, 충돌은 409다. burst quota는 DB count 성공 뒤 신규 요청에만 소비한다.
  5. client-version POST status 계약은 200 success, 400 invalid JSON/shape/session UUID, 401 unauthenticated, 403 actor-session ownership mismatch, 413 oversized stream, 415 wrong media type, 429 rate limit, 500 auth actor/DB failure로 고정한다. session ownership query의 `error`를 null row와 구분한다. GET은 200, exact no-store JSON metadata shape/buildStamp/deploymentId/swVersion을 보장하며 누락된 server build metadata는 503으로 fail-closed한다.
  6. Dev schema test fixture는 오직 기존 `behavior_events.id UUID PK`를 mock한다. deterministic UUID format/domain separation, duplicate-first, 23505 reread, DB error ordering을 검증하며 `event_key` 컬럼/unique constraint/migration을 전제로 하지 않는다.
  7. `assert.ok(true)`, `expect(true)`, 조건부 assertion 생략을 제거한다. `e2e/qa-081-pwa-safe-update.spec.ts`가 이번 변경에서 생긴 placeholder라면 HEAD의 실제 회귀로 복원하고, 유지해야 하면 사용자 관찰 가능한 실제 assertion으로 교체한다. `rg -n 'assert\\.ok\\(true\\)|expect\\(true\\)'` 결과가 0이어야 한다.
- 완료 test:
  - 각 enum의 valid 1건과 invalid string/type/unknown key table test가 있고 invalid 요청 insert 0회다.
  - route의 정상 `/child/home`, UUID segment와 위 모든 공격 변형을 table test한다.
  - 두 API 모두 charset JSON success, 유사 media type 415, 다중 chunk 경계 이하 success, chunk 합계 초과 413+cancel을 검증한다.
  - telemetry existing/count/insert/re-read 각 DB error가 500이며 다음 DB 단계 호출 0회다. duplicate는 rate-limit 호출 0회, 신규 rate 초과는 insert 0회다.
  - client-version의 200/400/401/403/413/415/429/500/503를 각각 독립 test로 검증한다.

### U7-b — production backdoor 없는 실제 Dev-app 2-page E2E (순차 5, 10분 이내)

- 대상 파일:
  - `lib/pwa/renderServiceWorker.ts`
  - `app/api/pwa/sw/route.ts`
  - `app/api/pwa/sw/route.test.ts`
  - `e2e/support/pwaUpdateProxy.ts`(신규, test-only)
  - `e2e/fixtures/pwaDevApp.ts`(신규, test-only)
  - `e2e/qa-078-pwa-safe-update.spec.ts`
  - `playwright.config.ts`
  - `package.json`
- 허용되는 test seam:
  - product에 허용되는 유일한 seam은 U6-a의 pure `renderServiceWorker(config)` export다. production route는 오직 배포 build 상수를 넣으며 request/query/header, `NEXT_PUBLIC_*`, localStorage, test flag로 값을 덮어쓸 수 없다. UI, `PwaServiceWorker`, SW protocol에는 `__PWA_TEST_STATE__`, navigator override, test-only button/API를 추가하지 않는다.
  - version 전환은 product endpoint를 변조하지 않고 Playwright 프로세스가 직접 띄우는 loopback reverse proxy가 담당한다. proxy는 실제 Dev app의 모든 HTML/JS/API를 upstream으로 전달하고 `/sw.js`만 동일 product renderer로 현재 fixture build를 생성하며 `/api/client-version`만 같은 fixture metadata로 응답한다. control HTTP endpoint는 만들지 않고 Playwright fixture 객체의 `setTarget(v1|v2)` 메서드로 메모리 상태를 바꾼다.
  - proxy module은 `NODE_ENV === "test" && PWA_E2E_PROXY === "1"`이 아니면 시작 즉시 throw하고 `127.0.0.1`에만 bind한다. `e2e/**`는 app import graph와 production build output에 들어가지 않는다. 정적 test는 production route에 `PWA_E2E`, `fixture`, request query/header override가 없고 Next route manifest에 `/_e2e`가 없음을 확인한다. 따라서 production에서 켤 endpoint/flag 자체가 없다.
- 정확한 E2E 변경:
  1. 현재 `setupPageHtmlRoute`, `installPwaMock`, `navigator.serviceWorker` 재정의, `window.__PWA_TEST_STATE__`를 전부 제거한다. 두 page는 하나의 real `BrowserContext`와 proxy origin을 공유하고 실제 Dev app React tree의 `PwaServiceWorker`와 실제 browser ServiceWorker registration을 사용한다.
  2. fixed Dev QA account로 실제 로그인하고 page A에서 실제 Mission 또는 Free Chat을 시작해 start/active/pending write/reward settlement hazard를 만든다. page B는 실제 safe route ready까지 기다린다. 합성 DOM과 page.evaluate로 hazard boolean을 직접 바꾸지 않는다.
  3. proxy target을 v1에서 v2로 바꾸고 page B의 실제 modal/update 버튼을 사용한다. page A active 동안 v2가 waiting이어도 controller build, navigation count, unload count, 대화 turn/reward UI가 유지되고 activation success telemetry가 0인지 확인한다.
  4. page A에서 실제 UI로 대화/정산을 끝내고 safe route로 이동해 explicit readiness를 기다린다. page B에서 새 proposal을 실행해 v2 controller가 두 page에 적용되고, 각 safe page reload 최대 1회, SKIP_WAITING에 해당하는 controller version transition 1회인지 public SW identity handshake와 navigation entries로 검증한다.
  5. reload 후 proxy latest metadata, document build stamp, controller swVersion이 marker target과 일치한 뒤에만 gate가 사라지고 proxy가 받은 marker의 `successEventId` telemetry가 정확히 1건인지 확인한다. mismatch/5xx 변형에서는 gate/marker가 유지되고 success 0건이어야 한다.
  6. forged page message는 exact worker source가 아니므로 무시되고, legacy controller fixture는 `GET_VERSION` fallback으로 fatal recovery를 시작하되 직접 success/activation하지 못함을 실제 SW에서 검증한다.
- 완료 test:
  - E2E가 upstream Dev app 없이는 skip/pass하지 않고 명시 실패한다. synthetic HTML, navigator/SW mock, vacuous assertion이 0건이다.
  - 실제 2-page active 보호, barrier abort/expiry 후 재시도, exact waiting install, one-shot activation, reload latest handshake, legacy stale recovery를 사용자 관찰과 public browser API로 검증한다.
  - `test:pwa-update`는 U6/U7 unit·component·route test와 real Dev-app E2E 명령을 구분해 포함하고, unit 성공만으로 E2E 성공을 주장하지 않는다.

## 14. U6/U7 최종 순서·게이트

- 구현 순서: `U6-a -> U6-b -> U6-c -> U7-a -> U7-b`. 파일/계약이 겹치므로 병렬 구현하지 않는다.
- U6-c 완료 전 U7-b를 시작하지 않는다. U7-a API test가 통과하지 않으면 telemetry proxy assertion을 신뢰하지 않는다.
- 정적 완료조건: 위 exact source/identity/barrier/marker/API 계약, `Promise.all(` 0건, vacuous assertion 0건, production test override 0건을 별도 Codex Sol 리뷰 세션이 확인한다.
- 동적 완료조건: 정적 리뷰 통과 뒤 fresh agy QA 세션이 실제 Dev app·실제 browser SW·동일 context 2-page E2E를 수행한다. mock-only test 결과는 게이트 ②를 대신하지 않는다.
- 잔여 위험: worker runtime nonce는 worker process 재시작 때 바뀌므로 live message binding에만 사용한다. durable post-reload identity는 buildStamp/deploymentId/swVersion/scriptURL 전체 일치로 보장한다. 현재 Dev schema에서는 rolling rate limit의 전역 원자성은 보장하지 못하지만 deterministic UUID PK idempotency는 원자적이다.

## 15. U8 final review remediation

이 절은 U6/U7 구현에 대한 최종 독립 정적 리뷰의 모든 반려 사항을 교정하는 최종 실행 계약이다. 아래 단위는 **U8-1 → U8-2 → … → U8-8 순차 실행**하며 각 단위는 10분 이내다. 각 워커는 명시된 파일 외에는 수정하지 않고, 기존 request의 fail-closed 정책·active conversation 보호·Production 승인제를 완화하지 않는다. 브라우저나 서버에 QA 비밀번호·Supabase key·Vercel token 등 client credential을 새로 노출하는 경로와 Production test backdoor는 금지한다.

### 15.1 공통 최신 버전/대상 worker 계약

`LatestVersionMetadataV1`은 `/api/client-version`의 성공 응답과 update flow가 공유하는 단일 schema다.

```ts
type LatestVersionMetadataV1 = {
  schemaVersion: 1;
  buildId: string;
  buildStamp: string;
  deploymentId: string;
  swVersion: string;
  serviceWorkerScriptUrl: string;
};
```

- 모든 필드는 필수 non-empty string이며 unknown key, query/hash, cross-origin URL, dot segment, encoded delimiter/control을 거부한다. `serviceWorkerScriptUrl`은 same-origin canonical pathname으로 비교한다.
- 새 문서 자체의 배포 표지는 `DocumentDeploymentMarkerV1 { schemaVersion: 1, buildId, buildStamp, deploymentId }`로 고정한다. root server layout이 credential이 아닌 이 세 값만 inert `<meta>`에 렌더링하고 client는 exact name이 각 1개인 경우에만 strict parse한다. client bundle 상수나 reload 직전 in-memory 값으로 새 문서 버전을 추정하지 않는다. marker 누락·중복·빈 값·latest target 불일치는 verified latest가 아니다.
- update 클릭 시 **먼저** no-store version check를 성공시키고 그 응답 전체를 immutable `targetMetadata`로 고정한 뒤에만 `registration.update()`를 호출한다. `registration.update()` 뒤에 다시 읽은 다른 deployment를 기존 target과 섞지 않는다.
- exact waiting target은 다음을 모두 만족해야 한다: `registration.waiting === candidate`, `candidate.state === "installed"`, canonical `candidate.scriptURL.pathname === targetMetadata.serviceWorkerScriptUrl`, fresh MessageChannel v1 identity의 `buildId/swVersion`이 target과 일치, identity의 `workerNonce`가 이후 proposal/표결/`SKIP_WAITING`까지 동일. 하나라도 바뀌면 `target-replaced` 또는 `identity-mismatch`로 중단한다.
- reload marker는 `ReloadPendingMarkerV3`로 올린다. 필수 필드는 `{ schemaVersion: 3, proposalId, target: LatestVersionMetadataV1, activationWorkerNonce, successEventId, documentBuildStampBeforeReload, startedAt, expiresAt, reason }`다. 저장 성공과 strict read-back 일치 전에는 reload하지 않는다. post-reload 성공은 새 no-store latest metadata, 새 document build stamp, 현재 controller의 fresh v1 identity/scriptURL이 marker의 `target`과 모두 일치할 때만 인정한다.
- runtime nonce는 live worker instance binding 전용이다. post-reload controller process 재시작으로 nonce가 바뀌는 것은 허용하되, marker의 durable target 5필드 전체 일치와 fresh v1 identity를 반드시 요구한다.

### U8-1 — exact target metadata와 V3 reload marker 고정 (순차 1, 10분 이내)

- 허용 파일:
  - `lib/pwa/clientVersion.ts`
  - `lib/pwa/clientVersion.test.ts` (없으면 신규)
  - `lib/pwa/documentDeployment.ts` (신규)
  - `lib/pwa/documentDeployment.test.ts` (신규)
  - `lib/pwa/buildStamp.ts`
  - `lib/pwa/updateFlow.ts`
  - `lib/pwa/updateFlow.test.ts`
  - `app/api/client-version/route.ts`
  - `app/api/client-version/route.test.ts`
  - `app/layout.tsx`
- 구현 계약:
  1. 위 `LatestVersionMetadataV1` parser/serializer를 한 모듈에 두고 client, route test, update flow가 공유한다. endpoint는 `Cache-Control: no-store`와 exact schema만 반환한다. server layout은 동일 server-side build/deployment source에서 `DocumentDeploymentMarkerV1` meta를 렌더링하고 client parser는 DOM의 exact 단일 marker만 허용한다.
  2. `performRegistrationUpdate`는 optional target field를 받지 않는다. 완전한 `targetMetadata`가 없으면 `invalid-target`이고 `registration.update()` 호출은 0회다.
  3. update 전 target snapshot을 그대로 exact-worker 검증과 `ReloadPendingMarkerV3.target`에 전달한다. 설치 도중 latest가 바뀌거나 waiting worker가 교체되면 activation하지 않고 새 check부터 재시도한다.
  4. V1/V2 marker는 stale update를 실행하지 않고 strict parse 실패로 격리·삭제한 뒤 safe screen에서 새 version check를 요구한다. marker parse 실패 자체가 reload를 유발해서는 안 된다.
- 완료 테스트:
  - latest metadata 및 document marker의 누락/중복/unknown/빈 문자열/비정상 script URL table test에서 update·marker·reload 0회.
  - exact target A를 잡은 뒤 endpoint가 B로 바뀌어도 A/B field 혼합 0회, waiting B를 A로 활성화 0회.
  - V3 marker 필드 하나 누락·변조·만료 시 reject, 정상 round-trip은 byte-equivalent target을 유지.
- 의존: 없음. U8-2 이후 단위는 이 타입만 사용한다.

### U8-2 — exact SW source/nonce, strict votes, awaited `skipWaiting` (순차 2, 10분 이내)

- 허용 파일:
  - `lib/pwa/renderServiceWorker.ts`
  - `lib/pwa/swProtocol.ts`
  - `lib/pwa/swProtocol.test.ts`
  - `app/api/pwa/sw/route.ts`
  - `app/api/pwa/sw/route.test.ts`
- 구현 계약:
  1. `PWA_PREPARE_ACTIVATION`은 exact waiting worker의 MessageChannel port로만 받고, proposal의 target build/SW version/script pathname/worker nonce가 현재 worker runtime과 일치해야 한다. page broadcast나 `event.source` 없는 메시지를 activation authority로 사용하지 않는다.
  2. worker는 `clients.matchAll({ type: "window", includeUncontrolled: true })`로 얻은 exact client ID 집합을 각 pass 시작 시 freeze한다. vote는 `event.source`가 해당 `WindowClient`, source.id가 expected clientId, proposalId/passId/requestNonce/voteNonce/target/workerNonce가 모두 일치하고 strict v1 schema일 때만 센다. `PWA_TAB_ACK` 같은 legacy alias, duplicate, 이전 pass, 새로 생긴 client의 vote는 ACK로 세지 않는다.
  3. 2-pass 모두 동일 규칙으로 전원 `ACK_SAFE`여야 한다. timeout, client disappearance/addition, NACK, malformed vote, postMessage failure는 ABORT다.
  4. message listener는 `event.waitUntil(runConsensus())`를 사용한다. 성공 path는 `await self.skipWaiting()` 완료 후에만 `PWA_ACTIVATION_COMMITTED`를 응답하며 reject/throw면 ABORT한다. proposal별 skipWaiting은 정확히 1회다.
- 완료 테스트:
  - forged clientId, wrong `event.source`, reused nonce, stale pass, legacy ACK, duplicate ACK, pass 사이 client 증감 각각 skipWaiting 0회.
  - skipWaiting pending 동안 COMMITTED 0회, resolve 후 1회, reject 시 ABORT 및 COMMITTED 0회.
  - SW response script에 배포별 UUID literal이 박히지 않고 runtime nonce 생성이 worker evaluation당 정확히 1회임을 확인.
- 의존: U8-1.

### U8-3 — proposal lease 재사용과 Production barrier 동기화 수명주기 (순차 3, 10분 이내)

- 허용 파일:
  - `lib/pwa/tabUpdateConsensus.ts`
  - `lib/pwa/tabUpdateConsensus.test.ts`
  - `lib/pwa/conversationActivity.ts`
  - `lib/pwa/conversationActivity.test.ts`
- 구현 계약:
  1. localStorage lease는 strict `{ schemaVersion: 1, proposalId, ownerTabId, target: LatestVersionMetadataV1, workerNonce, createdAt, expiresAt }`다. 같은 exact target/nonce의 유효 lease가 있으면 모든 탭은 그 proposal을 재사용·관찰하며 새 proposal을 만들거나 덮어쓰지 않는다. 다른 target lease는 ABORT/expiry 전까지 대기한다.
  2. lease owner만 COMMIT/ABORT/만료 정리를 발행한다. owner가 사라지면 lease TTL 후 새 CAS 획득이 가능하다. storage write 후 strict read-back CAS가 실패하면 activation을 시작하지 않는다.
  3. barrier는 Production에서도 항상 켜지는 runtime singleton이며 test flag에 의존하지 않는다. 상태는 `closed | preparing(proposalId,target,expiresAt) | committed(proposalId,target,expiresAt)`다. storage event, worker PREPARE/COMMIT/ABORT, initial mount의 기존 lease를 동일 reducer로 처리한다.
  4. 동일 proposal 이벤트는 idempotent하다. replacement, ABORT, owner expiry, storage removal은 exact proposal만 닫고, stale timer가 새 proposal을 닫지 못한다. committed barrier는 reload 또는 post-reload verification까지 start/resume을 막되 marker 만료/검증 실패 시 central blocking-error 상태로 소유권을 넘겨 영구 orphan barrier가 되지 않는다.
  5. conversation hazard 획득은 barrier 검사와 token 등록을 하나의 synchronous API로 묶어 `barrier active + new hazard`가 같은 tick에 공존하지 않게 한다.
- 완료 테스트:
  - 두 owner 경쟁, 같은 target lease reuse, 다른 target 대기, owner crash+expiry, replacement, stale timer, unmount/remount를 fake clock/storage로 검증.
  - Production mode에서도 PREPARE 수신 즉시 barrier가 열리고 Mission/Free Chat hazard 신규 획득이 거부됨을 검증.
- 의존: U8-1, U8-2.

### U8-4 — pathname revision 선행과 중앙 blocking modal/navigation lock (순차 4, 10분 이내)

- 허용 파일:
  - `lib/pwa/routeReadiness.ts`
  - `lib/pwa/routeReadiness.test.ts`
  - `components/pwa/PwaSafeRouteReady.tsx`
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
  - `app/layout.tsx`
  - `app/page.tsx`
  - `app/child/home/page.tsx`
  - `app/parent/home/page.tsx`
  - `app/login/page.tsx`
  - `app/offline/page.tsx`
- 구현 계약:
  1. route store는 `{ pathname, routeRevision, readyRevision, navigationInFlight }`를 가진다. link/submit/popstate/pagehide/programmatic pathname change를 감지하면 **readiness 판정보다 먼저** routeRevision을 증가시키고 ready를 취소한다. 새 safe page의 `PwaSafeRouteReady`가 mount commit 후 exact pathname+revision token을 제출해야만 ready다. 이전 pathname/revision token은 무효다.
  2. safe route는 `/`, `/child/home`, `/parent/home`, `/login`, `/offline` exact match만 허용한다. redirect-only `/parent`와 prefix 추론은 금지한다.
  3. blocking modal은 root `PwaServiceWorker` 한 곳만 렌더한다. 화면 중앙, background dim, outside/ESC/back 닫기 없음, `나중에` 없음, 실제 `[업데이트]`/실패 시 `[다시 업데이트]` 버튼만 둔다. route별 별도 modal 또는 banner를 gate authority로 사용하지 않는다.
  4. modal open부터 verified-latest까지 capture-phase same-origin anchor/form, programmatic route drift, popstate를 중앙에서 막고 `업데이트를 진행해 주세요.`를 표시한다. original pathname+search+hash와 history state는 gate token으로 복원하고 새 route commit 전 check/activation하지 않는다.
  5. active/unsafe route에서는 update check 결과를 `UPDATE_DEFERRED`로만 보존하며 중앙 modal·navigation lock·reload를 띄우지 않는다. safe+ready transition 때 같은 target을 재검증한 뒤 modal을 연다.
- 완료 테스트:
  - pathname change와 ready callback이 같은 tick이어도 새 revision ready 전 check/ACK 0회.
  - stale readiness, `/parent`, unsafe prefix, navigation in-flight에서 check 0회.
  - central modal에서 outside/ESC/back/anchor/form/router drift 전부 차단되고 실제 update button만 activation을 시작.
- 의존: U8-3.

### U8-5 — unexpected `controllerchange` defer와 단일 recovery coordinator (순차 5, 10분 이내)

- 허용 파일:
  - `lib/pwa/recoveryCoordinator.ts`
  - `lib/pwa/recoveryCoordinator.test.ts`
  - `lib/pwa/staleClientRecovery.ts`
  - `lib/pwa/staleClientRecovery.test.ts`
  - `lib/pwa/clientVersionGate.ts`
  - `lib/pwa/clientVersionGate.test.ts`
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
  - `components/StaleClientRecovery.tsx`
- 구현 계약:
  1. `controllerchange`는 marker/proposal의 exact workerNonce와 expected transition이 일치할 때만 expected다. expected transition도 handler에서 즉시 success 처리하지 않고 V3 marker 저장 확인 후 reload하고 post-reload handshake를 거친다.
  2. **unexpected controllerchange on active/unsafe tab**은 reload·modal·barrier open을 모두 0회로 한다. 현재 대화/turn/reward settlement를 그대로 계속하고 strict `ExternalControllerPendingV1 { schemaVersion:1, observedAt, controllerBuildId, controllerSwVersion, controllerScriptUrl }`를 sessionStorage와 in-memory에 기록한다. identity를 못 얻어도 active session을 끊지 않고 `identity-unverified` deferred 상태만 남긴다.
  3. 이후 hazard=0이며 safe exact route+ready가 되면 pending을 소비해 no-store latest check를 새로 수행한다. document/server/controller가 이미 완전 일치하면 pending과 임시 barrier를 닫는다. 불일치면 중앙 blocking modal로 전환한다. network/identity 실패면 retry 가능한 blocking-error로 전환하고 proposal barrier/lease를 정리한다. 모든 branch에 bounded timeout/finally cleanup이 있어 permanent barrier가 남지 않는다.
  4. `clientVersionGate`의 cache purge + direct `window.location.reload()` 경로는 제거한다. Mission gate와 `StaleClientRecovery`는 signal만 coordinator에 전달하며 update/consensus/marker/reload/latest verification은 root orchestrator만 실행한다.
  5. stale v1은 `event.source === navigator.serviceWorker.controller`, exact controller fresh identity nonce/build/swVersion, same-origin `/_next/static/` pathname, 허용 status/signature를 모두 요구한다. stale v0은 exact current controller source + bounded legacy `GET_VERSION` identity 일치일 때만 coordinator에 signal을 줄 수 있다. v0는 proposal, SKIP_WAITING, reload, success telemetry를 직접 실행하지 못한다.
- 완료 테스트:
  - active Mission/Free Chat 중 unexpected controllerchange에서 unload/reload/modal/barrier 0, turn 입력 가능 유지. safe 전환 후 일치면 cleanup, 불일치면 중앙 modal, 오류면 retry state이며 barrier가 TTL/cleanup 후 orphan되지 않음.
  - direct stale reload/cache purge 호출 0. forged source/nonce/path/status와 legacy unknown controller는 coordinator 호출 0.
- 의존: U8-4.

### U8-6 — telemetry feature CHECK와 strict API fail-closed (순차 6, 10분 이내)

- 허용 파일:
  - `supabase/migrations/20260815190000_behavior_events_pwa_update_feature.sql` (조건부 신규)
  - `lib/analytics/logBehaviorEvent.ts`
  - `lib/analytics/deterministicEventId.ts`
  - `lib/analytics/deterministicEventId.test.ts`
  - `lib/pwa/updateTelemetry.ts`
  - `lib/pwa/updateTelemetry.test.ts`
  - `app/api/analytics/pwa-update/route.ts`
  - `app/api/analytics/pwa-update/route.test.ts`
  - `app/api/client-version/route.ts`
  - `app/api/client-version/route.test.ts`
- migration 정책:
  1. 먼저 Dev의 실제 `behavior_events` feature CHECK 정의와 migration chain을 read-only 조회한다. 기존 허용 feature 중 의미가 정확히 맞는 값이 있으면 그 값을 재사용하고 migration을 만들지 않는다. `home`, `mission`, `freechat`, `app_session`처럼 일부 화면/세션 의미로 오해되는 값을 편의상 쓰지 않는다.
  2. 현재 schema처럼 정확한 cross-cutting PWA lifecycle feature가 없다면 위 파일 하나로 기존 CHECK 목록을 보존하면서 `'pwa_update'`만 추가한다. constraint 이름을 실제 DB에서 확인해 drop/recreate하고 `NOT VALID` 후 기존 행 검증 및 `VALIDATE CONSTRAINT`를 포함한다. 테이블/행 reset, 기존 event 변경은 금지한다.
  3. migration 적용은 **Dev 전용 승인 게이트**다. 새 migration이 필요하면 Dev에만 적용·schema test 후 QA한다. Production DB 적용은 별도 Owner 승인과 배포 단계로 남기며 이번 구현/QA에서 실행하지 않는다.
- API 계약:
  1. telemetry/client-version POST는 exact base media type `application/json`(+선택 charset)만 허용하고 stream bytes를 4KB/2KB로 제한, 초과 즉시 reader cancel+413. malformed/unknown/missing/schema type은 400, media 415.
  2. auth 없음 401, actor/session ownership 불일치 403, auth/ownership DB error 500을 구분한다. deterministic UUID event id와 actor/event/client_event_id가 모두 일치하는 existing row만 200 duplicate다. 충돌 409, lookup/count/insert/re-read 오류 500, quota 429이며 오류 뒤 insert를 계속하지 않는다.
  3. route/metadata enum은 strict allowlist다. raw route와 자유 텍스트/PII/credential은 properties에 저장하지 않는다.
- 완료 테스트:
  - Dev schema에 실제 선택 feature insert가 성공하고 invalid feature는 CHECK로 실패. Production 적용 명령/상태 변화 0.
  - 200/400/401/403/409/413/415/429/500/503 및 DB 단계별 fail-closed를 non-vacuous table test로 검증.
- 의존: U8-1. U8-5 완료 후 실행해 coordinator telemetry 이름과 상태를 확정한다.

### U8-7 — Production backdoor/credential 없는 real DEV proxy fixture (순차 7, 10분 이내)

- 허용 파일:
  - `lib/pwa/renderServiceWorker.ts`
  - `app/api/pwa/sw/route.ts`
  - `app/api/pwa/sw/route.test.ts`
  - `e2e/support/pwaUpdateProxy.ts`
  - `e2e/fixtures/pwaDevApp.ts`
  - `playwright.config.ts`
  - `package.json`
- 구현 계약:
  1. proxy는 `NODE_ENV=test && PWA_E2E_PROXY=1`, loopback bind에서만 시작하고 실제 deployed DEV app을 upstream으로 전달한다. Production app route/query/header/env/localStorage에서 target metadata를 바꾸는 hook, `/_e2e` route, client-exposed Supabase/service-role/Vercel credential은 0개다.
  2. proxy는 Playwright Node process 내부 API `setTarget()`으로만 `/api/client-version`과 `/api/pwa/sw` 응답을 v1/v2로 전환한다. product `renderServiceWorker(config)`를 그대로 사용하고 일반 HTML/JS/API/auth cookie는 DEV upstream을 통과한다.
  3. 고정 DEV QA child username은 전용 env로 받고 비밀번호는 `QA_TEST_PASSWORD`가 없으면 즉시 fail한다. 소스 기본값, 빈 문자열, 다른 비밀번호 fallback, Production 계정 후보는 금지한다. 비밀번호/토큰은 log·trace·screenshot에 출력하지 않는다.
  4. fixture는 하나의 실제 BrowserContext와 두 Page를 제공하고 `serviceWorkers: "allow"`를 쓴다. `navigator.serviceWorker` monkey patch, synthetic HTML, `window.__PWA_TEST_STATE__`, custom vote listener, test-only product button/API는 금지한다.
- 완료 테스트:
  - env 미설정 시 명확한 preflight failure, secret 출력 0. DEV unavailable이면 skip이 아니라 실패.
  - production build route manifest/import graph에 test proxy·`/_e2e`·override flag 0.
  - 두 page가 실제 React root, 실제 auth cookie, 실제 browser SW controller를 공유함을 public API로 확인.
- 의존: U8-2, U8-6.

### U8-8 — 실제 제품 UI 2-page E2E, 회귀 게이트와 EOL containment (순차 8, 10분 이내)

- 허용 파일:
  - `e2e/qa-078-pwa-safe-update.spec.ts`
  - `package.json`
- 실제 E2E 계약:
  1. Page A와 B를 v1 controller에서 시작한다. Page A는 실제 고정 DEV QA child로 로그인한다. 별도 test에서는 (a) `/child/missions`에서 실제 `시작하기/이어하기`를 누르고 child 답변을 실제 입력·전송해 turn request가 진행 중이거나 pending persistence가 존재하는 Mission hazard, (b) `/chat`에서 실제 `시작하기`와 실제 child 입력·전송으로 active/pending/reward-settlement Free Chat hazard를 만든다. hazard는 product UI와 observable request/DOM/DB 상태로만 증명하며 window global을 쓰지 않는다.
  2. Page B는 실제 `/child/home` ready 상태에서 proxy를 v2로 전환하고 앱 자체 version check가 렌더한 **실제 중앙 blocking modal**을 기다린다. Playwright는 modal의 실제 `업데이트` 버튼을 클릭한다. `page.evaluate`로 proposal 전송, state 변경, vote listener 등록, skipWaiting 호출은 금지한다.
  3. Page A hazard 동안 Page B의 실제 버튼을 눌러도 v2 activation/reload/unload/controller switch/success telemetry가 0이고 Page A의 동일 Mission session 또는 Free Chat session에서 다음 child turn이 성공해야 한다. Page B는 delayed/retry UX로 돌아오며 permanent spinner/barrier가 없어야 한다.
  4. Page A에서 실제 UI로 turn 완료/대화 종료 후 `/child/home`으로 이동하고 readiness를 기다린다. Page B에서 같은 실제 modal/button으로 재시도해 exact v2 waiting worker가 1회 activate되고 각 safe page reload가 최대 1회인지 navigation entries, controller identity, network log로 확인한다.
  5. reload 후 server latest/document build/controller identity가 V3 marker target과 모두 같을 때만 modal/marker가 사라지고 동일 `successEventId` telemetry가 정확히 1건이다. endpoint 5xx, malformed latest, wrong controller/script의 각 변형은 modal+marker 유지, success 0, retry 가능이어야 한다.
  6. unexpected external controllerchange 변형은 Page A active 중 실제 v2 controller로 바뀌어도 reload/modal 0과 후속 child turn 성공을 확인하고, 안전 화면 전환 후 pending reconciliation이 modal 또는 verified-current cleanup으로 끝나며 barrier가 남지 않는지 확인한다.
- 최종 명령/증거:
  - unit/component/route test와 `test:pwa-update:e2e`를 분리 실행하고, 실제 UI locator·network log·controller identity·navigation count·telemetry/DB row를 evidence에 남긴다. unit 통과를 E2E 통과로 대체하지 않는다.
  - `rg -n 'window\.__PWA_TEST_STATE__|__isConversationActive|addEventListener\("message"|navigator\.serviceWorker\s*=|assert\.ok\(true\)|expect\(true\)' e2e/qa-078-pwa-safe-update.spec.ts e2e/fixtures e2e/support` 결과가 0이어야 한다.
  - 구현 시작 전/각 단위 후 index 기준 파일별 EOL을 기록한다. 기존 CRLF 파일은 CRLF, LF 파일은 LF로 보존하고 global formatter/전체 저장을 금지한다. `git diff --ignore-space-at-eol --check`와 허용 파일 목록을 대조해 line-ending-only diff 및 범위 밖 변경 0이어야 한다.
- 의존: U8-1~U8-7 전체.

### 15.2 U8 최종 게이트

- 정적 게이트: exact latest target, strict SW source/nonce/vote, awaited skipWaiting, lease reuse, Production barrier lifecycle, pathname-before-readiness, central modal/navigation lock, unexpected controllerchange defer, stale v1/v0 strictness, API/auth/media/schema fail-closed, telemetry feature CHECK, no direct stale reload가 각각 비어 있지 않은 test로 증명돼야 한다.
- 동적 게이트: fresh agy QA가 실제 deployed DEV app·실제 Chromium SW·실제 제품 Mission 및 Free Chat UI·동일 context 2-page로 U8-8을 수행한다. synthetic HTML, browser API mock, 직접 proposal/message 호출, custom vote handler 결과는 PASS 근거가 아니다.
- DB gate: migration이 필요하면 Dev만 적용되고 `behavior_events.feature='pwa_update'` 정상 insert/invalid reject와 telemetry idempotency를 확인한다. Production migration/deploy/smoke는 Owner 명시 승인 전 0건이다.
- 보안 게이트: client bundle/HTML/trace/screenshot/log에 QA password, service-role key, Supabase token, Vercel token 0건이며 Production override endpoint/flag 0건이다.
- 최종 판정: 위 정적→Dev migration(조건부)→real DEV E2E 순서를 모두 통과하기 전에는 078을 완료 또는 Production 배포 가능으로 표시하지 않는다.

## 16. U9 latest static review remediation

U9는 U8 구현 뒤 남은 최신 정적 리뷰 blocker만 교정한다. 정책은 그대로 fail-closed이며, 아래 순서를 건너뛰거나 unit test만으로 real DEV E2E를 대체하지 않는다. 구현 워커는 agy, 정적 판정은 별도 Codex 세션, 동적 판정은 fresh agy QA 세션이 맡는다. 모든 단위는 순차이며 각 10분 이내다.

### 16.1 단일 strict latest snapshot 계약

`fetchLatestVersionMetadataV1()`은 자동 확인과 사용자의 `업데이트` 클릭이 함께 쓰는 유일한 latest fetch다.

```ts
type LatestFetchResult =
  | { ok: true; snapshot: Readonly<LatestVersionMetadataV1> }
  | { ok: false; code: "network" | "timeout" | "http" | "redirect" | "media" | "oversize" | "malformed" | "invalid-schema" };
```

- 요청은 exact same-origin `/api/client-version`, `GET`, `cache: "no-store"`, `credentials: "same-origin"`, `Accept: application/json`, bounded timeout을 사용한다. redirect/cross-origin final URL, non-2xx, JSON이 아닌 base media type, 크기 초과, malformed JSON, unknown/missing/empty field는 실패다.
- 성공 응답은 `parseLatestVersionMetadata()`를 통과한 새 객체를 `Object.freeze`해 immutable snapshot으로 반환한다. 응답 body, React state, env fallback, proposal, worker identity를 조합해 metadata를 만들지 않는다.
- 자동 확인과 update 클릭은 각각 새 snapshot을 얻는다. 클릭 snapshot이 자동 확인 snapshot과 5개 target field 중 하나라도 다르면 자동 확인 때 잡은 waiting worker/proposal을 폐기하고 클릭 snapshot을 대상으로 처음부터 다시 설치·검증한다.
- `performRegistrationUpdate({ registration, targetSnapshot })`은 strict parser를 다시 통과한 완전한 snapshot만 받는다. 없거나 변조됐으면 명시적 `invalid-target`이며 `registration.update()`, worker message, marker write, reload는 모두 0회다.
- `installed-target` 결과는 `{ targetSnapshot, worker, identity }`를 함께 반환한다. `worker === registration.waiting`, installed state, canonical script path, identity build/SW version, non-empty runtime nonce가 snapshot과 정확히 맞아야 한다. 이 결과의 snapshot/nonce만 proposal과 marker에 사용한다.
- `ReloadPendingMarkerV3.target`의 exact 5필드 `buildId/buildStamp/deploymentId/swVersion/serviceWorkerScriptUrl`은 클릭 snapshot에서 그대로 복사한다. `proposal.targetBuild`, `NEXT_PUBLIC_*`, `BUILD_STAMP`, `worker.scriptURL`, `"v1"`, 빈 nonce fallback으로 보충하지 않는다. marker는 activation 요청 전에 strict save+read-back을 마쳐 controllerchange race에서도 항상 존재해야 한다.

### U9-1 — strict no-store fetch와 exact worker/marker wiring (agy 순차 1, 10분 이내)

- 허용 파일:
  - `lib/pwa/clientVersion.ts`
  - `lib/pwa/clientVersion.test.ts`
  - `lib/pwa/updateFlow.ts`
  - `lib/pwa/updateFlow.test.ts`
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
- 구현 계약:
  1. 위 fetch helper를 `lib/pwa/clientVersion.ts`에 두고 자동 check와 update click에서만 호출한다. 두 경로의 자체 `fetch(...).json()` 파서는 삭제한다.
  2. automatic sequence는 `latest GET/strict parse → 현재 document 비교 → mismatch일 때 performRegistrationUpdate(exact snapshot) → exact waiting identity 저장 → modal`이다. network/schema 실패는 worker update나 no-update로 오판하지 않는다.
  3. click sequence는 `latest GET/strict parse → modal target과 exact 비교 → performRegistrationUpdate(click snapshot) → exact identity/nonce → proposal/barrier → marker strict save/read-back → activation request`다. click-time target drift면 이전 worker/proposal/marker를 재사용하지 않는다.
  4. activation abort/error면 exact proposal marker와 barrier만 정리한다. marker save/read-back 실패, missing nonce, target mismatch면 activation/reload 0회와 retry 가능한 blocking error다.
- 완료 테스트:
  - fetch init의 `no-store`, same-origin credentials, Accept, timeout과 redirect/media/size/http/network/malformed/schema error mapping을 검증.
  - automatic과 click이 같은 helper를 호출하되 서로 다른 immutable snapshot을 얻고 A→B race에서 marker 5필드는 전부 B이며 A/B 혼합 0건.
  - undefined/partial/mutable target은 `invalid-target`, `registration.update()` 0회. wrong waiting identity/nonce/script는 marker·activation·reload 0회.
  - marker 저장 전 controllerchange를 발생시켜도 reload하지 않고 error로 남으며, 정상 path는 activation 요청 전에 marker read-back이 완료됨을 호출 순서로 검증.
- 의존: 없음.

### U9-2 — loose post-reload metadata/fallback 제거와 typed history lock (agy 순차 2, 10분 이내)

- 허용 파일:
  - `lib/pwa/updateFlow.ts`
  - `lib/pwa/updateFlow.test.ts`
  - `lib/pwa/documentDeployment.ts`
  - `lib/pwa/documentDeployment.test.ts`
  - `components/PwaServiceWorker.tsx`
  - `components/PwaServiceWorker.test.tsx`
- 구현 계약:
  1. `ServerVersionMetadata`, `ReloadPendingMarkerV2 | V3` union, `body.buildId` 단독 허용, `buildStamp/deploymentId = buildId`, `swVersion = "v1"`, `marker.targetBuildId`, `BUILD_ID` document fallback을 전부 제거한다.
  2. post-reload와 external-controller reconciliation도 U9-1의 `fetchLatestVersionMetadataV1()`만 사용한다. strict V3 marker target, strict `DocumentDeploymentMarkerV1`, current controller fresh v1 identity/canonical script path가 latest snapshot과 전부 일치할 때만 success/marker clear가 가능하다.
  3. latest fetch 실패는 `network/timeout/http/media/malformed/invalid-schema`를 유지해 offline 또는 retryable blocking error로 매핑한다. 어느 오류도 marker clear, success telemetry, reload loop를 일으키지 않는다.
  4. history state ref는 `unknown`으로 선언한다. gate가 push하는 state는 strict `PwaGateHistoryStateV1 { schemaVersion:1, gateToken:UUID, originalUrl:string }`만 포함하고 원래 state를 새 object에 spread/중첩하지 않는다. cleanup은 exact owned token일 때만 보관한 `unknown` 원래 state와 URL을 `replaceState`로 복구한다. `any`, timestamp token fallback, foreign history entry 삭제는 금지한다.
- 완료 테스트:
  - `ServerVersionMetadata`, V2 marker union, optional/fallback metadata 문자열이 source와 test에서 0건.
  - 5개 latest field 중 하나, document marker 3개 중 하나, controller build/SW/script 중 하나가 다르면 success/clear/reload 0이고 retry modal+marker 유지.
  - 5xx와 malformed 뒤 재시도 success는 동일 marker/successEventId를 사용해 success telemetry 정확히 1회.
  - primitive/object/null history state, foreign entry, back/forward, cleanup/unmount에서 원래 state/URL 보존과 gate-owned entry만 정리됨을 검증; `any` 0건.
- 의존: U9-1.

### U9-3 — loopback Node fault API 확장 (agy 순차 3, 10분 이내)

- 허용 파일:
  - `e2e/support/pwaUpdateProxy.ts`
  - `e2e/support/pwaUpdateProxy.test.ts` (신규)
  - `e2e/fixtures/pwaDevApp.ts`
- 구현 계약:
  1. Node 객체에만 노출되는 discriminated API를 둔다: `setClientVersionMode("normal" | "http-503" | "malformed-json")`, `setLatestTarget("v1" | "v2")`, `setServiceWorkerTarget("v1" | "v2")`, `resetFaults()`.
  2. `http-503`은 actual loopback `/api/client-version`에서 no-store JSON 503, `malformed-json`은 status 200/application-json이지만 실제 invalid bytes를 반환한다. `JSON.stringify`로 malformed를 정상 JSON으로 바꾸지 않는다.
  3. wrong-controller fault는 latest target=v2, service-worker target=v1처럼 endpoint 두 개의 in-memory target을 독립 설정해 실제 browser controller identity가 latest와 달라지게 한다. 단순히 client-version body의 `swVersion`만 바꾸는 방식은 금지한다.
  4. fault state는 test별 reset되고 concurrent request가 시작할 때 immutable local snapshot을 잡아 응답 중간에 mode/target이 섞이지 않는다. proxy stop/reset 후 stale fault가 다음 test에 남지 않는다.
  5. 제어용 HTTP endpoint, query/header/env로 fault를 켜는 product hook, `page.route`, production import/API는 추가하지 않는다. proxy는 기존 test-only runtime guard와 approved DEV upstream만 유지한다.
- 완료 테스트:
  - 실제 loopback HTTP client로 normal exact V1, raw malformed bytes, exact 503, latest-v2/SW-v1 응답을 검증.
  - mode 변경 경계의 동시 요청은 요청 시작 snapshot 하나만 사용하고 cross-test reset을 검증.
  - production app import graph/route manifest에 proxy/fault symbol/endpoint 0건.
- 의존: U9-2.

### U9-4 — real loopback fault E2E로 교체 (agy 순차 4, 10분 이내)

- 허용 파일:
  - `e2e/qa-078-pwa-safe-update.spec.ts`
  - `e2e/fixtures/pwaDevApp.ts`
  - `package.json`
- 구현 계약:
  1. client-version/SW 오류 test의 `page.route`, `route.fulfill`, `unroute`, synthetic JSON handler를 전부 제거하고 U9-3 Node API만 사용한다. Playwright page는 실제 loopback URL을 통해 product fetch와 browser SW lifecycle을 그대로 통과한다.
  2. 503 test는 modal의 실제 `업데이트` 버튼 직전에 `http-503`을 켜고 실제 GET 503을 network recorder로 확인한다. marker/activation/reload/success 0, retry modal 유지 후 `normal` 복구와 실제 버튼 재시도로 성공한다.
  3. malformed test는 actual GET 200 raw invalid JSON을 확인한다. parse failure가 retry modal로 귀결되고 marker/activation/reload/success 0인 뒤 정상 복구한다.
  4. wrong-controller test는 latest=v2/SW=v1로 실제 update 버튼을 누른다. 실제 `/api/client-version` v2 → 실제 `/sw.js` v1 → exact identity mismatch 순서를 확인하고 activation/marker/reload/success 0으로 끝낸다. 이후 SW target=v2로 바꾸고 같은 UI retry가 성공해야 한다.
  5. 각 test `finally`에서 `resetFaults()`를 호출하고 BrowserContext/SW registration/cache 격리를 확인한다. DEV upstream unavailable, fixed QA credential missing, expected network request missing은 skip/pass가 아니라 실패다.
- exact QA network sequence:
  1. safe route ready.
  2. automatic `GET /api/client-version` (`no-store`) → strict snapshot A.
  3. mismatch일 때 browser `GET /sw.js` 또는 `/api/pwa/sw` → waiting worker 설치.
  4. MessageChannel identity → exact A worker/nonce 확인 → 실제 중앙 modal 표시.
  5. 사용자가 실제 `업데이트` 클릭.
  6. 새 `GET /api/client-version` (`no-store`) → strict immutable snapshot B.
  7. `registration.update()`에 따른 SW request → waiting worker exact identity/nonce 확인.
  8. proposal/barrier → V3 marker exact B 5필드 save/read-back.
  9. strict two-pass votes → awaited `skipWaiting` → expected `controllerchange`.
  10. reload된 문서의 deployment marker → 새 latest GET → current controller identity 비교.
  11. 전부 일치할 때만 marker clear, modal 해제, 동일 successEventId telemetry 1회.
- 완료 테스트:
  - network recorder가 위 순서를 실제 URL/status로 증명하고 client-version GET마다 `Cache-Control` request mode/response no-store를 기록.
  - 503/malformed/wrong-controller에서 최초 기대 밖 activation/reload/telemetry가 0이고 정상 mode 복구 후 동일 UI retry 성공.
  - `rg -n 'page\.route|route\.fulfill|page\.unroute|ServerVersionMetadata|useRef<any>|NEXT_PUBLIC_DEPLOYMENT_SHA|targetBuildId:\s*undefined'` 대상 파일 결과 0.
- 의존: U9-3.

### U9-5 — 독립 Codex 정적 게이트 (순차 5, 10분 이내, read-only)

- 검토 파일: U9-1~U9-4의 전체 허용 파일과 실제 diff.
- 판정 계약:
  - automatic/click/post-reload가 동일 strict helper를 사용하며 별도 loose parser/fallback이 0인지 추적한다.
  - snapshot A→B race, worker replacement, nonce change, marker-before-activation ordering, unexpected error cleanup을 코드 경로별로 확인한다.
  - proxy fault가 Node loopback 전용이고 Production hook/client credential/page interception이 0인지 확인한다.
  - unit test가 mocked loose object나 synthetic response만 검증하지 않고 실제 helper/loopback bytes를 행사하는지 확인한다.
- 통과 전 U9-6 실행 금지. 발견 사항은 코드 수정 없이 `[단순|복잡]`과 `[QA 인계]`로 반환한다.
- 의존: U9-4.

### U9-6 — fresh agy real DEV E2E 게이트 (순차 6, 10분 이내)

- 실행 대상: `e2e/qa-078-pwa-safe-update.spec.ts`의 503/malformed/wrong-controller와 정상 update/retry 시나리오.
- 판정 계약:
  - U9-4의 exact QA network sequence, 실제 modal/button, 실제 loopback response, 실제 browser SW identity/navigation/telemetry 증거를 제출한다.
  - unit/component PASS만 있거나 `page.route`/custom product hook이 발견되면 FAIL이다.
  - Dev만 사용하며 Production deploy, Production DB/env 변경, 고객 계정 사용은 0건이다.
- 의존: U9-5 정적 통과.

### 16.2 현재 unit test의 false-positive 가능성

현재 unit test는 PASS여도 안전성을 증명하지 못할 수 있다.

- `performRegistrationUpdate`에 target을 생략하거나 optional field를 주는 mock은 실제 `/api/client-version` no-store fetch/strict parse를 건너뛴다. 이 경우 `invalid-target`이어야 할 코드가 `no-update` 또는 installed-target로 통과할 수 있다.
- post-reload test가 loose `ServerVersionMetadata`, V2 marker, `buildId` fallback을 직접 만들어 주면 실제 malformed/누락 응답을 거부하는지 검증하지 않는다.
- identity mock이 worker object와 nonce를 독립적으로 반환하면 `registration.waiting` 교체나 identity nonce race를 놓친다.
- `page.route().fulfill()` 기반 E2E는 loopback proxy의 fault API, browser cache/no-store 동작, 실제 SW endpoint/controller mismatch를 우회한다. 특히 metadata body만 바꾼 wrong-controller test는 실제 controller가 v2인 채 다른 이유로 error modal이 떠도 통과할 수 있다.
- history test가 object literal만 쓰거나 `any`를 허용하면 primitive/null/foreign state 손실과 gate ownership 침범을 놓친다.

따라서 U9 완료 조건은 strict helper 단위 test + actual loopback proxy test + 실제 DEV browser network sequence가 모두 일치하는 것이다. 하나라도 빠지면 078을 완료로 판정하지 않는다.
