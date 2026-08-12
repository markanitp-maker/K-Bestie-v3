# 089 — 30일 이벤트 일일 활동 집계 구현 계획

## 변경 개요

- 기존 원장 행은 그대로 둔 채 nullable 신규 컬럼과 신규 행 대상 제약을 forward-only
  migration으로 추가한다.
- 신규 activity-aware RPC가 이벤트 행 잠금, 일일 원장 insert, 합산 카운터 갱신을 한
  트랜잭션에서 수행한다. 구 시그니처 RPC도 새 로직으로 위임해 우회 집계를 막는다.
- 자유대화 종료 RPC가 세션 종료, 서버 저장 발화 기반 적격성 판정, Gold Key 원장 insert,
  이벤트 RPC 호출을 한 트랜잭션으로 묶는다.

## 대상 파일

- `requests/089-mission-event-manual-adjustments.md`
- `requests/_dashboard.md`
- `docs/plans/089-mission-event-daily-activity.md`
- `supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql`
- `supabase/migrations/tests/mission_event_daily_activity_verification.sql`
- `app/api/chat/pause/route.ts`
- `lib/events/missionOnboarding.ts`

## 구현 순서

1. 이벤트 원장 컬럼/제약과 Gold Key 자유대화 출처/일일 멱등 키를 추가한다.
2. activity-aware 이벤트 RPC, legacy wrapper, mission_progress 트리거를 교체한다.
3. 자유대화 적격성 및 원자 지급 RPC를 추가하고 pause API를 연결한다.
4. SQL 검증으로 동시·반복 호출과 KST 날짜 경계를 확인한다.
5. Dev에만 적용하고 catalog/행 결과를 SELECT한 뒤 타입체크와 전체 테스트를 수행한다.

## 위험과 방어

- 기존 원장 호환: 신규 컬럼은 기존 행에 NULL을 유지하고 백필하지 않는다.
- 중복/레이스: 이벤트 행 잠금과 유일 제약, Gold Key 일일 partial unique index를 함께 쓴다.
- 부분 반영: Gold Key insert와 이벤트 RPC를 하나의 DB 함수 호출 안에서 실행한다.
- 권한/위조: pause API는 기존 사용자 인증 후 service RPC를 호출하고, RPC가 세션 child/type을
  다시 검증한다.
- 배포 혼합기: legacy RPC를 제거하지 않고 새 일일 정책으로 위임해 구 호출도 안전하게 한다.
