# 078 PWA Safe Update Gate 구현 계획

## 목표와 Source of Truth

- 현재 Production 기준선 `94affe5`를 보존한다. 이 기준선의 `BUILD_STAMP`, `/api/client-version`, 동적 `/sw.js`, `StaleClientRecovery`를 버전·fatal recovery Source of Truth로 재사용한다.
- 알려진 새 버전은 active Mission/Free Chat을 절대 중단하지 않고, 안전 화면으로 나온 뒤에만 중앙 blocking gate를 표시한다.
- 안전 화면 최초 진입 및 client load 후 1시간이 지난 다음 foreground/안전 화면 재진입에서 metadata-only version check를 강제한다.
- fatal chunk/asset 404 복구는 기존 `StaleClientRecovery` 자동 self-heal 경로로 분리 유지한다.
- 업데이트 적용 전후 Mission progress, turn, reward, Free Chat eligibility 데이터는 읽거나 변경하지 않는다. reload 뒤 각 화면의 기존 server rehydrate/reconciliation을 그대로 사용한다.

## 데이터 흐름

1. 클라이언트는 `BUILD_STAMP`와 sessionStorage의 client-loaded/check timestamp를 가진다.
2. safe route 진입 또는 visible 복귀에서 정책이 check를 요구하면 `/api/client-version`의 작은 metadata payload를 `no-store`로 조회한다.
3. current/latest build가 같으면 gate 없이 통과한다. fetch 실패는 update 있음으로 오판하지 않고 비차단 network 상태와 telemetry만 남긴다.
4. mismatch 또는 waiting worker가 발견되면 active conversation 여부를 확인한다.
   - active: 내부 pending만 기억하고 reload/modal을 금지한다.
   - inactive safe screen: 중앙 blocking modal을 연다.
5. 사용자가 업데이트를 누르면 registration.update → waiting/installing 정착 → `SKIP_WAITING` 1회 → controllerchange 확인 → reload guard 저장 → hard reload 순서로 적용한다.
6. 적용 지연/실패는 spinner에 고착하지 않고 retry 가능한 blocking error로 전환한다. 최신 handshake 성공 전 주요 기능은 overlay와 navigation guard로 차단한다.

## 대상 파일

- `lib/pwa/updateGate.ts` / `lib/pwa/updateGate.test.ts`: 1시간·safe route·conversation defer·version metadata·worker action 순수 정책.
- `lib/pwa/updateTelemetry.ts`: 허용 이벤트, correlation 생성, fail-open client logger.
- `app/api/analytics/pwa-update/route.ts` / `route.test.ts`: 인증 actor 기반 PII 없는 telemetry 저장.
- `app/api/client-version/route.ts` 및 테스트: build/deployment/SW metadata 응답 확장(기존 `buildId` 하위 호환).
- `components/PwaUpdateGateModal.tsx` / 테스트: 중앙 blocking, 닫기·나중에 없음, focus trap, retry/error/warning.
- `components/PwaServiceWorker.tsx`: update check/state machine/activation/reload/navigation gate 통합.
- `lib/pwa/conversationActivity.ts`: active conversation 상태 event 계약.
- `app/chat/page.tsx`, `app/child/missions/page.tsx`: 실제 active 상태만 publish.
- `e2e/qa-078-pwa-safe-update.spec.ts`: DEV gate A~I의 브라우저 fixture.
- `package.json`: 신규 unit test를 기존 PWA test script에 포함.

## 10분 단위 agy 분할

1. 순차 U1 — 순수 update gate 정책, metadata API, telemetry API/클라이언트와 단위 테스트.
2. 순차 U2 — blocking modal과 `PwaServiceWorker` 상태 머신 통합, 기존 095 fatal recovery 보존.
3. 순차 U3 — Mission/Free Chat active 상태 연결과 PWA unit/integration 테스트 보강.
4. 게이트① — 별도 Codex 정적 리뷰. 비즈니스 로직·Service Worker lifecycle·데이터 보존 관점 검토.
5. 게이트② — 별도 agy 세션이 Dev E2E fixture를 작성·실행. 제품 코드는 수정하지 않는다.

## 위험요소와 불변 조건

- path만으로 active conversation을 판단하면 Mission 시작 전 화면이 영구 defer될 수 있으므로 실제 화면 상태 event를 우선하고 초기 hydration 동안만 conservative path fallback을 쓴다.
- waiting/installing worker에 중복 `SKIP_WAITING`을 보내지 않는다.
- controllerchange 확인 전 reload하지 않는다. 단, 기존 fatal asset recovery는 별도 bounded reload 계약을 유지한다.
- network check 실패는 update available로 취급하지 않는다.
- 모달이 열린 상태에서 outside click, Escape, browser back, 주요 Link activation으로 우회할 수 없어야 한다.
- `buildId` 기존 소비자와 Mission `ensureMissionClientVersion` 응답 계약을 깨지 않는다.
- 새 DB migration, Production 사용자 데이터 변경, Mission/Free Chat session 생성·삭제는 없다.

## 검증

- `node --import tsx --test` PWA 관련 unit/integration PASS.
- `node node_modules/typescript/bin/tsc --noEmit` PASS.
- `npm run build`는 dev server가 없는 격리 worktree에서 PASS.
- Dev: no-update, update blocking, retry, controllerchange reload, active Mission/Free Chat defer, 1시간 safe check, duplicate session/reward 0.
- Production: 최신 사용자 modal 0, stale fixture gate/reload/latest handshake, Mission start/resume와 Free Chat 진입, 5xx 증가 없음.

