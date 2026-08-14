# Mission PWA·계정 전환 영구 복구 계획

## 목표

설치형 PWA의 구버전 실행, 동일 기기의 계정 전환, 로컬 pending turn 잔존, 일시적 네트워크 실패가 겹쳐도 Mission이 영구 오류 화면에 고착되지 않게 한다. 서버 DB snapshot을 Mission 진입의 단일 기준으로 사용하며 Production 배포와 DB 변경은 이 작업 범위에서 제외한다.

## 대상 파일

- `app/api/client-version/route.ts`: 현재 배포 build ID 조회 계약 추가
- `lib/pwa/clientVersionGate.ts`: Mission 진입 전 client/server build 정합 및 waiting worker 활성화
- `lib/pwa/clientVersionGate.test.ts`: 동일 버전·업데이트 필요·실패 계약 검증
- `app/api/mission/v3/today-progress/route.ts`: 서버가 검증한 actor/child/family/businessDate scope 반환
- `lib/mission/clientScope.ts`: 계정·자녀·날짜별 Mission local scope 관리
- `lib/mission/clientScope.test.ts`: 계정 전환과 동일 scope 계약 검증
- `lib/mission/pendingTurnStore.ts`: 단일 전역 pending을 scope별로 격리하되 legacy pending 보존
- `lib/mission/pendingTurnStore.test.ts`: scope 간 오염 및 안전한 삭제 계약 검증
- `app/child/missions/page.tsx`: PWA version gate → 서버 snapshot → scope 정합 → start/resume/terminal 순서 강제, retry 시 서버 재조회
- `app/child/missions/page.real-repro.test.ts`: 기존 실제 진입 재현 mock을 새 version/snapshot/scope 계약에 맞춤
- `package.json`: 신규 Mission/PWA 계약 테스트를 기본 test suite에 포함

## 데이터 흐름

1. Mission 진입 시 `/api/client-version` GET으로 현재 배포 build ID를 확인한다.
2. client build와 다르면 waiting service worker를 활성화하고 reload한다. 즉시 갱신할 worker가 없거나 네트워크가 실패하면 Mission 시작을 막고 기술 용어 없는 업데이트 안내를 표시한다.
3. build가 같을 때만 `/api/mission/v3/today-progress`를 호출한다.
4. 서버가 검증한 `actorUserId/familyId/childId/businessDate`로 local Mission scope를 확정한다.
5. 이전 scope와 다르면 현재 scope의 상태만 사용한다. 다른 계정의 IndexedDB pending은 삭제하지 않고 해당 scope에 보존한다.
6. snapshot이 유효할 때만 start/resume/terminal 화면으로 이동한다. 4xx/5xx/파싱 실패는 구형 v2 경로로 추정하지 않는다.
7. `다시 시도`는 직전 POST를 반복하지 않고 1번부터 다시 수행해 DB SSOT로 재hydrate한다.

## 위험요소

- 최초 배포 이전의 아주 오래된 PWA는 새 version gate 코드를 갖고 있지 않다. 이번 배포가 한 번 활성화된 이후의 모든 후속 배포부터 강제 게이트가 작동한다.
- 진행 중 대화에서 service worker를 교체하면 turn 손실 위험이 있으므로 진입 전까지만 강제하고 active Mission 중에는 기존 deferred 정책을 유지한다.
- 기존 전역 IndexedDB pending은 삭제하지 않는다. 현재 서버 session과 일치할 때만 legacy fallback으로 읽고 reconciliation한다.
- 서버 Mission/turn/question/progress 데이터와 DB migration은 변경하지 않는다.

## 완료 조건

- 계정 A pending이 계정 B Mission 진입에 사용되지 않는다.
- 잘못된/실패한 snapshot이 v2 start로 우회되지 않는다.
- 모든 entry 오류의 `다시 시도`가 server snapshot 재조회로 시작한다.
- client/server build 불일치 상태에서 Mission start 요청이 발생하지 않는다.
- 관련 Node 테스트, `tsc --noEmit`, `git diff --check`가 통과한다.
