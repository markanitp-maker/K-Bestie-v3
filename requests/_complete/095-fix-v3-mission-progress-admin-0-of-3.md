095-fix-v3-mission-progress-admin-0-of-3.md

# V3 하루 미션 진행도 `0/3` 표시 오류 수정 및 5개 Goal 기준 통일

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

현재 V3 하루 미션의 실제 완료 기준은 아래와 같다.

```text
총 10개 Conversation Goal 중
SATISFIED 5개 달성
→ mission_progress.status = COMPLETED
→ 황금열쇠 +1 지급
```

실제 아이 화면과 보상 로직은 이미 정상이다.

문제는 관리자 `리포팅 수동 실행` 화면이 V3에서도 과거 V2 필드인:

```text
mission_progress.valid_answer_count = 0
mission_progress.required_valid_count = 3
```

을 읽고 있어 실제 5개 Goal을 모두 달성한 완료 미션도:

```text
0/3
0/3 완료
```

처럼 잘못 표시되는 것이다.

작업 완료 후 V3 `daily_single`은 반드시:

```text
미시작
N/5 진행중
5/5 완료
```

형태로 표시되어야 한다.

과거 V3 데이터도 DB UPDATE 없이 `conversation_goals`를 조회하여 즉시 정상 표시되어야 한다.

### 대표님 테스트 정상 프로세스

1. 관리자 `리포팅 수동 실행` 화면 진입
2. 오늘 실제 미션 완료 아이 확인
3. 기존 `0/3 완료`가 아니라 `5/5 완료`로 표시되는지 확인
4. 진행 중 아이가 있으면 `1/5`, `2/5`, `3/5`, `4/5 진행중` 형태로 실제 Goal 상태와 일치하는지 확인
5. 미션 미시작 아이는 `미시작` 또는 정책상 `0/5`로 일관되게 표시되는지 확인
6. 실제 아이 미션 화면의 별 5개, 완료 처리, 황금열쇠 지급이 기존과 동일하게 정상인지 확인

PASS 결과:

```text
V3 관리자 진행도 = conversation_goals SATISFIED / 5
V2 기존 진행도 = 기존 valid_answer_count / required_valid_count
V3 완료 미션 0/3 표시 0건
기존 보상/리텐션 로직 영향 0건
```

---

## 1. 상태 / 우선순위

- 상태: 구현 요청
- 우선순위: P1
- 대상: V3 하루 미션 진행도/관리자 표시
- 개발 주체: Claude Code
- Production 감사 완료: YES
- DB DDL Migration 필요: NO

---

## 2. 감사로 확정된 사실

### 2-1. V3 실제 Source of Truth

| 영역 | Source of Truth |
|---|---|
| 미션 진행도 | `conversation_goals.status = 'SATISFIED'` 개수 |
| 완료 기준 | `TARGET_COMPLETION_COUNT = 5` |
| 완료 여부 | `mission_progress.status = 'COMPLETED'` |
| 보상 지급 | `gold_key_ledger`, `reward_type='mission_v3_complete'` |
| `valid_answer_count` | V3 미사용, 레거시 V2 잔재 |
| `required_valid_count` | V3 미사용, 초기 프로토타입 잔재 |

### 2-2. Production 실측

```text
V3 daily_single 전체 세션: 34건
V3 완료 세션: 23건

완료 23건 중
valid_answer_count = 0
satisfied_goals = 5
→ 23건 전부

V3 34건 중
required_valid_count = 3
→ 34건 전부
```

즉 현재 V3 완료 세션의 100%가 관리자 메타데이터 기준으로는 모순 상태다.

### 2-3. 실제 미션/보상은 정상

실제 아이 화면은 V3 전용 API에서:

```text
goalProgress.satisfied
completionThreshold = 5
```

를 읽기 때문에 정상이다.

리텐션/완료율 집계도:

```text
mission_progress.status = COMPLETED
```

를 사용하므로 현재 통계 왜곡은 확인되지 않았다.

---

## 3. 정확한 Root Cause

### 원인 A — V3 시작 시 잘못된 레거시 값 저장

파일:

```text
app/api/mission/v3/start/route.ts
```

현재:

```typescript
required_valid_count: 3
```

V3 실제 기준과 불일치.

### 원인 B — V3는 valid_answer_count를 갱신하지 않음

V3 turn 로직은:

```text
conversation_goals.status
```

만 갱신한다.

따라서:

```text
mission_progress.valid_answer_count
```

는 시작 시 0에서 계속 0으로 남는다.

이것은 V3 구조상 정상이며, 이 값을 V3 진행도로 읽는 관리자 API가 잘못된 것이다.

### 원인 C — 관리자 리포팅 API가 V2/V3를 동일 계산식으로 처리

파일:

```text
app/api/admin/reporting/children/route.ts
```

현재 V3 `daily_single`도:

```text
valid_answer_count
required_valid_count
```

를 그대로 읽음.

결과:

```text
실제 5/5 완료
→ 관리자 0/3 완료
```

---

## 4. 수정 원칙

V2와 V3를 명확히 분리한다.

### V2

```text
round_type IN ('round1_day', 'round2_night')
```

기존 로직 유지:

```text
valid_answer_count
required_valid_count
```

### V3

```text
round_type = 'daily_single'
```

진행도:

```text
conversation_goals.status = 'SATISFIED' 개수
```

분모:

```text
TARGET_COMPLETION_COUNT = 5
```

완료 여부:

```text
mission_progress.status = 'COMPLETED'
```

---

## 5. 수정 대상 1 — 관리자 리포팅 API

파일:

```text
app/api/admin/reporting/children/route.ts
```

V3 `daily_single` 처리 시 더 이상:

```text
progress.valid_answer_count
progress.required_valid_count
```

를 Source of Truth로 사용하지 않는다.

대신 해당 V3 미션 세션/진행 row와 연결된 `conversation_goals`를 조회해:

```text
SATISFIED 개수
```

를 계산한다.

반환 예:

```json
{
  "validTurns": 5,
  "targetTurns": 5,
  "completed": true
}
```

진행 중:

```json
{
  "validTurns": 3,
  "targetTurns": 5,
  "completed": false
}
```

---

## 6. V3 Goal 연결 기준

`conversation_goals` 조회 시 이름이나 날짜만으로 연결하지 않는다.

현재 실제 FK/세션/mission_progress 관계를 확인하고 가장 안정적인 키로 연결한다.

우선순위:

```text
직접 FK / progress_id / session_id
→ child_id + business_date + V3 session 관계
```

정확한 schema에 있는 관계를 사용한다.

동일 아이의 복수 세션/재시작이 있어도 잘못 합산되지 않아야 한다.

---

## 7. 수정 대상 2 — V3 시작 메타데이터 통일

파일:

```text
app/api/mission/v3/start/route.ts
```

현재:

```typescript
required_valid_count: 3
```

를 제거하고 반드시 공통 상수 사용:

```typescript
TARGET_COMPLETION_COUNT
```

현재 값:

```text
5
```

숫자 `5`를 또 다른 하드코딩으로 복제하지 말고 가능하면:

```text
lib/mission-v3/goalEngine.ts
TARGET_COMPLETION_COUNT
```

를 재사용한다.

---

## 8. valid_answer_count 처리 정책

V3에서는 `valid_answer_count`를 새 Source of Truth로 되살리지 않는다.

즉:

```text
V3 진행도를 맞추기 위해
매 turn마다 valid_answer_count까지 동기화
```

하는 방향은 기본 권장안이 아니다.

권장:

```text
V3 진행도 = conversation_goals
V3 완료 여부 = mission_progress.status
```

로 단일화.

기존 컬럼은 V2 호환 목적으로 유지한다.

---

## 9. 수정 대상 3 — 아이 화면 fallback

파일:

```text
app/child/missions/page.tsx
```

감사에서 확인된:

```typescript
goalProgress?.completionThreshold ?? 3
```

를 V3 공통 기준으로 수정한다.

권장:

```typescript
goalProgress?.completionThreshold ?? TARGET_COMPLETION_COUNT
```

또는 클라이언트 import 구조상 공통 상수를 직접 사용할 수 없다면 중복 상수 방식을 피할 수 있는 안전한 공통 정의를 사용한다.

실제 API가 정상일 때 fallback이 사용되지 않더라도 잘못된 `3`은 제거한다.

---

## 10. 수정 대상 4 — 테스트 코드

파일:

```text
lib/mission-v3/policyResolution.test.ts
```

감사에서 확인된:

```text
required_valid_count ?? (isV3 ? 3 : 5)
```

V3 기준을 5로 통일한다.

관련 V3 테스트 전체에서:

```text
3
```

이 완료 기준으로 남아있는지 재검색한다.

---

## 11. `3` 하드코딩 전수 정리

최소 확인된 위치:

```text
app/api/mission/v3/start/route.ts
lib/mission-v3/policyResolution.test.ts
app/child/missions/page.tsx
```

작업 완료 전 프로젝트 전체에서 V3 문맥의:

```text
required_valid_count: 3
completionThreshold ?? 3
isV3 ? 3
```

형태를 다시 검색한다.

단, V3와 무관한 숫자 3까지 무분별하게 수정하지 않는다.

---

## 12. 관리자 표시 기준

V3 관리자 UI의 정상 표기를 아래처럼 통일한다.

### 미시작

권장:

```text
미시작
```

현재 테이블 구조상 숫자가 반드시 필요하면:

```text
0/5
```

가능.

### 진행 중

```text
1/5 진행중
2/5 진행중
3/5 진행중
4/5 진행중
```

### 완료

```text
5/5 완료
```

완료는 기존 성공 컬러/녹색 계열 UI 유지.

---

## 13. 과거 V3 데이터 처리

DB UPDATE/Backfill 하지 않는다.

이유:

```text
conversation_goals에 과거 V3 Goal 상태가 이미 보존됨
```

관리자 API가 올바른 Source를 읽도록 바꾸면 기존 V3 34건도 자동으로 정상 표시된다.

금지:

```text
기존 34건의 valid_answer_count를 5로 일괄 UPDATE
required_valid_count를 과거 row 전체 5로 강제 UPDATE
```

과거 레거시 메타데이터를 굳이 재작성하지 않는다.

---

## 14. 리텐션/분석 로직 변경 금지

현재 리텐션은:

```text
mission_progress.status = COMPLETED
```

를 기준으로 정상 집계되고 있다.

따라서 이번 작업에서 리텐션 완료율 계산식을 불필요하게 변경하지 않는다.

단, 향후 통합 Product Analytics가 V3 Goal 진행도 자체를 표시할 경우에는:

```text
conversation_goals SATISFIED
```

를 사용해야 한다.

---

## 15. 기존 V2 회귀 방지

V2:

```text
round1_day
round2_night
```

는 기존:

```text
valid_answer_count
required_valid_count
```

기반을 유지한다.

V3 수정 때문에 과거 V2 관리자 리포팅이 깨지면 안 된다.

---

## 16. 성능

관리자 아이 목록에서 V3 각 아이마다 `conversation_goals`를 개별 N+1 조회하지 않는다.

가능하면:

```text
해당 기간/세션의 conversation_goals 일괄 조회
→ 서버에서 group/count
```

또는 적절한 aggregate query/RPC를 사용한다.

관리자 화면 로딩 성능이 현재보다 크게 악화되지 않아야 한다.

---

## 17. 오류/데이터 이상 처리

예외적으로:

```text
mission_progress.status = COMPLETED
conversation_goals SATISFIED < 5
```

같은 실제 불일치가 발견되면 화면에서 임의로 5/5로 조작하지 않는다.

완료 상태와 Goal count를 별도로 확인 가능하게 처리하고 운영 로그/완료 보고에 남긴다.

이번 Production 감사에서는 완료 23건 모두 SATISFIED=5로 정상 확인됨.

---

## 18. QA

### Case A — 기존 완료 V3

Production/Dev의 기존 `daily_single COMPLETED` 세션.

기대:

```text
5/5 완료
```

### Case B — 진행 중 V3

SATISFIED=2.

기대:

```text
2/5 진행중
```

### Case C — 미시작

기대:

```text
미시작
```

또는 확정 UI 정책의 `0/5`.

### Case D — 신규 V3 시작

새 `mission_progress` 생성 후:

```text
required_valid_count = 5
```

또는 공통 상수 값 확인.

### Case E — 실제 아이 화면

별 5개 UI 정상.

### Case F — 완료 보상

5번째 Goal 달성:

```text
mission_progress.status = COMPLETED
gold_key_ledger +1
```

기존 정상 동작 유지.

### Case G — V2

기존 V2 진행도 표시 회귀 없음.

---

## 19. Production 검증

현재 감사에서 확인된 기존 V3 데이터를 다시 검증한다.

최소:

```text
완료 V3 3건 이상
진행 중 V3 1건 이상(존재 시)
```

완료 세션은:

```text
API = 5/5
관리자 UI = 5/5 완료
```

일치해야 한다.

전체 기존 V3 완료 23건에서 `0/3 완료` 표시가 더 이상 발생하지 않아야 한다.

---

## 20. 금지사항

- V3 실제 미션 완료 기준을 다시 3으로 변경 금지
- 황금열쇠 보상 RPC 임의 수정 금지
- conversation_goals 데이터 삭제/수정 금지
- 과거 V3 row 일괄 backfill 금지
- V2 진행 로직 삭제 금지
- 이름으로 Goal join 금지
- 관리자 화면 숫자만 하드코딩해 `5/5`로 표시 금지
- Production Secret/API Key/Token 출력 금지
- 전체 UUID 출력 금지

---

## 21. 완료 조건

- V3 관리자 진행도 Source = `conversation_goals.SATISFIED`
- V3 목표 기준 = `TARGET_COMPLETION_COUNT = 5`
- V3 `0/3` 표시 제거
- 기존 완료 V3 = `5/5 완료`
- 진행 중 V3 = `N/5 진행중`
- 신규 V3 `required_valid_count` = 5 기준
- 아이 화면 fallback 3 제거
- 관련 테스트 fallback 3 제거
- V2 기존 진행도 정상 유지
- 과거 V3 DB migration 없음
- 리텐션 완료율 로직 변경 없음
- N+1 없음
- TypeScript 오류 0
- Build 성공
- Dev QA PASS
- Production smoke PASS

---

## 22. 완료 보고

1. 기존 `0/3` Root Cause
2. 관리자 API 변경 내용
3. V3 Goal 집계 방식
4. `TARGET_COMPLETION_COUNT` 적용 위치
5. 제거한 V3 관련 `3` 하드코딩 목록
6. 과거 V3 데이터 표시 결과
7. 완료 세션 23건 정상화 확인
8. 진행 중 세션 표시 확인
9. V2 회귀 테스트
10. 아이 미션 별 5개 회귀 테스트
11. 황금열쇠 지급 회귀 테스트
12. 리텐션 통계 무변경 확인
13. TypeScript/Build
14. Dev QA
15. Production smoke
