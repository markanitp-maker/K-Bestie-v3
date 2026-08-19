# 사용자 관리 `처리 대기` Stale `creation_failed` 정리 및 재발 방지

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

현재 관리자 `사용자 관리` 상단 KPI의 `처리 대기 1`은 실제 미처리 요청이 아니라, 2026-08-12 아이 생성 1차 실패 후 약 45초 뒤 동일 아이가 정상 생성되었음에도 `child_approval_requests.status = 'creation_failed'` 레코드가 남아 계속 집계되는 Stale 데이터다.

이번 작업 완료 후:

```text
현재 Production
처리 대기 1
→ 처리 대기 0
```

이 되어야 한다.

또한 앞으로 동일 상황이 발생해도:

```text
아이 생성 1차 실패
→ creation_failed 기록
→ 이후 동일 아이 정상 생성 성공
→ 과거 creation_failed는 더 이상 관리자 "처리 대기"로 집계되지 않음
```

이어야 한다.

핵심 원칙:

```text
실제 관리자가 조치해야 하는 요청만 "처리 대기"에 포함한다.
이미 정상 처리된 과거 실패 이력은 보존 가능하지만 actionable pending으로 계산하지 않는다.
```

### 대표님 테스트 정상 프로세스

1. Production 관리자 `사용자 관리` 진입
2. 상단 `처리 대기` KPI 확인
3. 현재 Stale 1건 정리 후 `0` 표시 확인
4. 가족/부모/아이 목록 및 기존 정상 사용자에 영향 없는지 확인
5. 동일 아이가 이미 정상 생성된 `creation_failed` 이력이 다시 KPI에 포함되지 않는지 확인
6. 실제 `RESTORE_REQUESTED`, 실제 `plan_change_requests.pending`, 실제 미처리 `child_approval_requests`가 생기면 정상적으로 `처리 대기`에 포함되는지 회귀 테스트

PASS 기준:

```text
- 현재 Stale 1건이 처리 대기에서 제거됨
- 실제 정상 생성된 아이 계정/프로필은 그대로 유지
- 과거 실패 이력 때문에 처리 대기 숫자가 다시 올라오지 않음
- 실제 actionable 요청은 계속 정상 집계됨
- Production 데이터 손실 0건
```

## 1. 상태 / 우선순위 / 대상

- 상태: 구현 요청
- 우선순위: P1
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code
- 적용 대상:
  - 관리자 `사용자 관리` 상단 `처리 대기` KPI
  - `child_approval_requests`
  - 관련 관리자 API/집계 로직
  - 현재 Production에 남은 Stale `creation_failed` 1건
- 제외 대상:
  - 정상 생성된 아이 계정/프로필
  - 정상 가족 데이터
  - 실제 미처리 복구 요청
  - 실제 미처리 요금제 변경 요청
  - 실제 미처리 아이 승인/생성 요청

## 2. 목표

현재 `처리 대기` 계산은 다음 세 종류를 단순 합산한다.

```text
parents.account_status = 'RESTORE_REQUESTED'
+
plan_change_requests.status = 'pending'
+
child_approval_requests.status IN ('pending', 'creation_failed', 'PENDING_PAYMENT')
```

Antigravity Production READ-ONLY 감사 결과 현재 `처리 대기 1`은:

```text
parents RESTORE_REQUESTED = 0
plan_change_requests pending = 0
child_approval_requests creation_failed = 1
```

때문이다.

해당 `creation_failed`는 실제 미처리 요청이 아니다.

실제 타임라인:

```text
2026-08-12 15:35:54 KST
아이 생성 1차 실패
→ child_approval_requests.status = creation_failed

약 45초 뒤
2026-08-12 15:36:39 KST
동일 아이 프로필 + 계정 정상 생성 완료
→ 현재 정상 활성 상태

하지만 과거 creation_failed row 유지
→ 관리자 처리 대기 KPI에 계속 +1
```

최종 목표:

```text
"실패 이력"과 "실제 관리자 조치 필요 상태"를 분리한다.
```

## 3. 요구사항

### 3-1. 현재 Stale 1건 실행 직전 재검증

Production 수정 전에 반드시 READ-ONLY로 다시 확인한다.

확인 조건:

```text
- 대상 child_approval_requests.status = creation_failed
- 요청 시각이 기존 감사 대상과 일치
- 동일 가족/부모 아래 동일 아이가 실제 정상 생성되어 있음
- 정상 child_profile 및 auth/로그인 계정이 활성 상태임
- 별도의 실제 미처리 승인/생성 작업이 없음
```

감사 이후 상태가 달라졌으면 수정하지 말고 BLOCKER로 보고한다.

### 3-2. Stale 레코드 정리 정책

Stale `creation_failed`를 단순 DELETE하지 않는다.

먼저 `child_approval_requests.status`의 실제 enum/check constraint와 기존 종료 상태를 확인한다.

정책:

1. 이미 존재하는 적절한 terminal/resolved 상태가 있으면 그 상태로 정리
2. 별도 `resolved_at`, `completed_at`, `resolved_reason` 등 기존 컬럼이 있으면 현재 구조에 맞게 기록
3. 적절한 terminal 상태가 없다면 과거 실패 이력은 보존하되, KPI에서 actionable=false로 판정할 수 있는 최소 구조를 적용
4. 새로운 status를 임의로 invent하지 말 것
5. Production 실제 정상 아이 데이터는 절대 삭제/재생성하지 말 것

정리 사유는 코드/DB 구조가 허용하면 다음 의미를 남긴다.

```text
동일 아이가 이후 정상 생성되어 자동 해소된 과거 creation_failed
```

### 3-3. `처리 대기` KPI 계산 로직 수정

현재 확인된 경로:

```text
app/api/admin/users/overview/route.ts
```

현재 단순 합산에서 `creation_failed`를 무조건 actionable pending으로 세는 문제를 수정한다.

정상 기준:

```text
RESTORE_REQUESTED
→ 실제 복구 처리 필요 시 포함

plan_change_requests.status = pending
→ 실제 요금제 변경 처리 필요 시 포함

child_approval_requests
→ 실제 관리자 조치가 필요한 상태만 포함
```

`creation_failed`는 다음과 같이 처리한다.

```text
동일 아이가 아직 생성되지 않았고 실제 재처리/관리자 조치가 필요
→ 처리 대기 포함 가능

동일 아이가 이후 정상 생성됨
→ 처리 대기 제외
```

즉 status 문자열 하나만으로 판단하지 말고 실제 actionable 여부를 확인한다.

### 3-4. 동일 아이 정상 생성 판정 기준

이름 문자열만으로 동일 아이를 판정하지 않는다.

현재 실제 schema를 확인해 가능한 가장 안정적인 식별 관계를 사용한다.

예:

```text
parent/family 관계
child approval request의 요청 식별값
생성된 child_profile/member 연결
로그인 ID 또는 생성 요청 당시 고유 값
```

정확한 FK/식별자가 존재하면 반드시 그것을 우선 사용한다.

동명이인 오판 금지.

### 3-5. 정상 생성 성공 시 과거 실패 요청 자동 정리

현재 가입/아이 생성 흐름을 추적하여:

```text
1차 생성 실패 → creation_failed
2차/재시도 성공 → 정상 child 생성
```

이 발생할 때 기존 실패 요청이 자동으로 terminal/resolved 처리되도록 개선한다.

가능하면 성공 처리 지점에서 직접 정리한다.

목표:

```text
성공 후 stale creation_failed가 남아서
나중에 관리자 KPI를 오염시키는 구조 제거
```

### 3-6. 기존 이력 보존

과거 실패 원인은 운영/장애 분석에 유용할 수 있으므로 무조건 삭제하지 않는다.

가능하면:

```text
실패 이력은 보존
+
실제 처리 대기에서는 제외
```

구조로 유지한다.

### 3-7. 사용자 관리 상세 화면과 상태 일치

상단 KPI만 `0`으로 만들고 실제 상세/필터에서 여전히 대기 1건처럼 보이는 불일치가 생기면 안 된다.

`처리 대기`와 연결되는:

```text
사용자 관리 상세
아이 승인/생성 요청 목록
필터
배지
카운트
```

가 있다면 동일 actionable 정의를 사용하도록 공통화한다.

### 3-8. 공통 Source of Truth

가능하면 `isActionableChildApprovalRequest()` 또는 동등한 공통 helper/query 조건으로 정의를 한 곳에 둔다.

금지:

```text
overview KPI에서는 제외
다른 화면에서는 creation_failed 전체 포함
```

처럼 화면마다 계산 기준이 달라지는 것.

### 3-9. 현재 Production Stale 1건 정리

코드 수정과 별도로 현재 이미 남아 있는 Stale 1건을 안전하게 정리한다.

절차:

```text
READ-ONLY 재검증
→ 대상 1건 확정
→ 정상 아이 존재 재확인
→ 안전한 terminal/resolved 처리
→ KPI 재조회
→ 처리 대기 0 확인
```

Production 전체 `creation_failed` 일괄 수정 금지.

현재 대상 및 동일 조건을 만족하는 레코드만 정확히 처리한다.

## 4. 기존 구조 확인

Antigravity가 확인한 현재 집계 경로:

```text
app/api/admin/users/overview/route.ts
```

현재 계산:

```typescript
pending =
  parents.account_status === "RESTORE_REQUESTED"
  + plan_change_requests.status === "pending"
  + child_approval_requests.status IN (
      "pending",
      "creation_failed",
      "PENDING_PAYMENT"
    )
```

현재 Production 실측:

```text
RESTORE_REQUESTED = 0
plan_change pending = 0
child approval actionable 후보 = 1
실제 원인 status = creation_failed
```

실제 상태:

```text
동일 아이는 45초 뒤 정상 생성 완료
현재 정상 활성 상태
관리자 별도 처리 불필요
```

Source of Truth는 단순 status가 아니라:

```text
request status
+
실제 child 생성 여부
+
실제 관리자 조치 필요 여부
```

의 조합이어야 한다.

## 5. 금지사항

- Antigravity에게 수정 작업 넘기지 말 것
- 정상 아이 계정/프로필 삭제 금지
- 정상 가족 데이터 변경 금지
- 이름만으로 대상 row 수정 금지
- 모든 `creation_failed` 일괄 DELETE/UPDATE 금지
- 과거 실패 이력을 이유 없이 삭제 금지
- KPI 숫자를 하드코딩해서 0으로 만들지 말 것
- 실제 pending 요청을 제외시키지 말 것
- Production Service Role Key/API Key/Token 출력 금지
- 전체 UUID 로그 출력 금지
- 테스트용 데이터로 Production 수치 위조 금지

## 6. 모호성 처리

`child_approval_requests`의 terminal/resolved 상태명이 감사 결과에 명시되어 있지 않다.

따라서 구현 전에 반드시:

```text
status check constraint
enum
migration
실제 기존 status 값
```

을 확인한다.

적절한 기존 종료 상태가 있으면 재사용한다.

없으면 임의 status 문자열을 추가하지 말고, 현재 schema에 맞는 최소 구조를 제안/구현한다.

DB migration이 필요한 경우 이유와 영향 범위를 완료 보고에 포함한다.

## 7. QA

### 7-1. 현재 Production Stale 건

조건:

```text
creation_failed
+
동일 아이 정상 생성 완료
```

기대:

```text
처리 대기에서 제외
```

### 7-2. 실제 미처리 child approval

실제 아이가 아직 생성되지 않았고 관리자가 조치해야 하는 요청.

기대:

```text
처리 대기 포함
```

### 7-3. RESTORE_REQUESTED

부모 계정 복구 요청 존재.

기대:

```text
처리 대기 +1
```

기존 동작 회귀 없음.

### 7-4. 요금제 변경 pending

`plan_change_requests.status = pending`.

기대:

```text
처리 대기 +1
```

기존 동작 회귀 없음.

### 7-5. child pending / PENDING_PAYMENT

실제 actionable 요청이면 정상 집계.

기대:

```text
처리 대기 포함
```

### 7-6. 생성 실패 후 재시도 성공

시나리오:

```text
1차 실패 → creation_failed
2차 성공 → 정상 child 생성
```

기대:

```text
성공 직후 과거 실패 요청이 자동 해소
처리 대기 증가 없음
```

### 7-7. 동명이인 방어

같은 이름의 다른 아이가 존재해도 가족/부모/FK 기준으로 올바른 요청만 판단해야 한다.

### 7-8. 화면 정합성

확인:

```text
상단 처리 대기 KPI
관련 요청 리스트
필터
상세 배지
```

모두 동일한 actionable 기준.

### 7-9. Production Smoke

대표 테스트:

```text
사용자 관리 진입
→ 처리 대기 0 확인
→ 정상 가족/부모/아이 수 변동 없음
→ 정상 생성된 해당 아이 그대로 존재
```

### 7-10. 회귀 테스트

반드시 확인:

```text
가족 목록 정상
부모 목록 정상
아이 목록 정상
검색 정상
내부 테스트 제외 필터 정상
CSV 정상
실제 pending 요청 집계 정상
```

## 8. 완료 조건

- 현재 Stale `creation_failed` 1건 정리 완료
- Production `처리 대기` 0 확인
- 정상 아이 계정/프로필 유지
- 정상 가족 데이터 유지
- `creation_failed` 단순 status만으로 무조건 pending 집계하지 않음
- 동일 아이 정상 생성 시 stale 요청 자동 해소
- 실제 actionable pending은 계속 정상 집계
- KPI/리스트/필터 계산 기준 통일
- TypeScript 오류 0
- Build 성공
- Dev QA PASS
- Production smoke PASS
- 데이터 손실 0건

## 9. 완료 보고

1. 기존 `처리 대기 1`의 최종 원인
2. 현재 Stale row 실행 직전 재검증 결과
3. `child_approval_requests` 실제 status 구조
4. Stale row 정리 방식
5. KPI 계산 로직 변경
6. actionable 판정 기준
7. 생성 재시도 성공 시 자동 정리 구현
8. 현재 Production 처리 대기 변경 전/후
9. 정상 아이 데이터 보존 확인
10. 실제 pending 회귀 테스트
11. TypeScript/Build 결과
12. Dev QA 결과
13. Production smoke 결과
