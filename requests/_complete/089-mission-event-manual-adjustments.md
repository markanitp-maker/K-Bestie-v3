# 089 — 30일 미션 이벤트 일일 활동 집계 정책

## 목표

30일 이벤트의 활동 집계를 최신 정책에 맞춘다. 미션 게임플레이의 하루 라운드 구조나
V1 대화 흐름은 변경하지 않고, 이벤트에 반영되는 횟수만 DB에서 원자적으로 제한한다.

## 확정 정책

- 미션 완료: KST 하루 최대 1회
- 자유대화 보상조건 충족: KST 하루 최대 1회
- 합계: 하루 최대 2회, 30일 최대 60회
- 기존 정상 완료 데이터는 삭제·수정·소급 재작성하지 않는다.
- Production에는 쓰지 않는다. migration 적용과 동작 검증은 Dev에서만 수행한다.

## 구현 범위

1. 이벤트 완료 원장에 `activity_type`, `business_date`, `source_session_id`를 추가하고
   `(event_id, child_id, activity_type, business_date)` 유일성을 DB에서 보장한다.
2. `record_mission_event_completion`에 activity 타입별 KST 일 1회 멱등 집계를 적용한다.
3. 기존 미션 완료 경로는 `mission_complete` 활동으로 수렴시킨다.
4. 자유대화 종료 시 의미 있는 아이 발화 3턴 이상, 세션 60초 이상, 반복/필러 기반
   reward farming 방지 조건을 모두 만족한 같은 날 첫 세션에만 Gold Key와 이벤트를
   한 트랜잭션에서 반영한다.
5. 기존 합산 조회 응답 `mission_completed_count`는 유지한다.

## 제외 범위

- `app/api/mission/start/route.ts`의 `round1_day`/`round2_night` 잠금 구조
- V1/V2 미션 게임플레이·대화 완료 조건
- 073 Mission v3 재설계 파일과 그 구현 범위
- 기존 이벤트/Gold Key 원장 행의 백필·정정·삭제
- Production migration·데이터 쓰기

## 완료 조건

- `npx tsc --noEmit` 및 기존 테스트 통과
- 같은 날 미션 3회 → 이벤트 +1, 자유대화 미달 → +0, 적격 자유대화 → Gold Key와
  이벤트 각각 +1, 다음 KST 날짜에 두 활동이 다시 각각 +1 되는 SQL 검증 추가
- Dev migration 적용 후 신규 컬럼·체크·유일 제약을 SELECT로 확인
- AGENTS.md §5 셀프검증 7항목 통과
