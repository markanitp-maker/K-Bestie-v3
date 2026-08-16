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
