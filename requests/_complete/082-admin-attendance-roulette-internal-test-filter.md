# Request: 관리자 출석 룰렛 내부 테스트 계정 포함 필터 추가

> 완료: 2026-08-08 | main `893d03a` | Dev `dpl_149tL6DorxWakT8hd2cUBPr2Jt6R` | Production `dpl_3oZUrWbbpVtF9TZTy2tFJSFoWEjw`

## 0. 작업 목적

관리자 `출석 룰렛` 화면에서 실제 아이와 내부 테스트 아이가 함께 노출되고 있어 운영 수치와 룰렛 현황을 정확히 보기 어렵다.

Antigravity 읽기 전용 감사 결과, 내부 테스트 계정 판정 기준과 출석 룰렛 데이터 구조가 확인되었다.

이번 작업에서는 출석 룰렛 화면에 아래 체크박스를 추가한다.

```text
☐ 내부 테스트 계정 포함
```

기본값은 **체크 해제**이며, 실제 운영 아이만 표시한다.

체크하면 실제 아이 + 내부 테스트 아이를 모두 표시한다.

중요: 이 필터는 **조회/통계 화면에만 적용**하며 실제 룰렛 데이터, 황금열쇠 원장, One-shot Override 상태에는 어떠한 변경도 가하지 않는다.

---

# 1. 내부 테스트 계정 판정 Source of Truth

내부 테스트 계정 판정은 기존 리텐션 필터와 동일한 공식 기준을 사용한다.

핵심 컬럼:

```text
child_profiles.is_internal_test
family_members.is_internal_test
```

주의:

```text
child_profiles.is_test_account
```

는 대화 모드/A-B 테스트 목적이므로 운영 지표 제외 기준으로 사용하지 않는다.

공통 helper:

```text
lib/admin/retentionFilter.ts
getTestFamilyIds(service)
```

를 재사용한다.

판정 기준:

```text
아이 본인이 is_internal_test = true
또는
부모가 is_internal_test = true인 가족 소속 아이
→ 내부 테스트 계정
```

---

# 2. Production 감사 기준

Antigravity 감사 시점 Production:

```text
전체 등록 아이: 14명
실제 일반 아이: 12명
내부 테스트 아이: 2명
```

이 수치는 코드에 하드코딩하지 않는다.

실제 조회 시점 DB 값을 기준으로 계산한다.

---

# 3. UI 위치

출석 룰렛 상단 필터 영역에 체크박스를 추가한다.

권장 위치:

```text
[이름 또는 로그인 ID 검색................]   ☐ 내부 테스트 계정 포함
```

또는 KPI 카드 바로 위 공통 필터바.

문구는 정확히:

```text
내부 테스트 계정 포함
```

기본 상태:

```text
false
```

---

# 4. 체크박스 동작

## 체크 해제

```text
실제 일반 아이만 표시
```

제외:

```text
내부 테스트 아이
내부 테스트 가족 소속 아이
```

## 체크

```text
실제 일반 아이 + 내부 테스트 아이 모두 표시
```

테스트 아이는 이름 옆에 반드시:

```text
[테스트]
```

회색 또는 neutral badge로 표시한다.

---

# 5. API 파라미터

권장 API:

```text
GET /api/admin/events/attendance-roulette
```

query:

```text
includeTestAccounts=true|false
```

기본:

```text
false
```

클라이언트 기본값과 서버 기본값 모두 false로 맞춘다.

URL 파라미터를 생략하면 실제 운영 계정만 반환해야 한다.

---

# 6. 동일 필터를 적용해야 하는 영역

`includeTestAccounts`는 아래 **모든 영역에 동일하게 적용**한다.

1. 대상 아이 수
2. 오늘 참여 수
3. 오늘 미참여 수
4. 오늘 지급 황금열쇠 합계
5. 오늘 결과별 횟수
6. 이름/로그인 ID 검색 결과
7. 아이별 운영 목록
8. 월 점수
9. 퀴즈 리더보드 순위
10. 1등과의 격차
11. 황금열쇠 보유량
12. 오늘 룰렛 참여 여부
13. 최근 결과
14. One-shot Override pending 표시

필터마다 서로 다른 모수를 쓰면 안 된다.

---

# 7. KPI 계산

## 대상 아이

기본:

```text
실제 아이 수
```

체크 시:

```text
실제 아이 + 테스트 아이
```

## 오늘 참여

해당 필터 대상 아이 중:

```text
attendance_roulette_days
또는 실제 출석 참여 원장 기준
```

오늘 KST 참여한 고유 아이 수.

## 오늘 미참여

```text
대상 아이 수 - 오늘 참여 아이 수
```

## 오늘 지급 열쇠

당일 KST:

```text
gold_key_ledger
reason = 'attendance'
```

의 `SUM(amount)`.

테스트 계정 제외 상태에서는 테스트 아이의 원장 row를 통계에서 제외한다.

원장 자체는 삭제/변경하지 않는다.

---

# 8. 오늘 결과별 횟수

당일 KST `attendance_roulette_spins`에서 결과별 count.

예:

```text
꽝
한번 더
황금열쇠 +1
황금열쇠 +3
황금열쇠 +5
황금열쇠 +7
황금열쇠 +9
```

`includeTestAccounts=false`이면 테스트 아이의 spin row는 집계에서 제외한다.

체크 시 포함한다.

---

# 9. 아이별 운영 목록

기본 컬럼은 기존 유지.

예:

```text
순위
아이
월 점수
1등과 차이
황금열쇠
오늘 룰렛
최근 결과
다음 룰렛
설정
```

테스트 계정 포함 시 아이 이름 옆:

```text
[테스트]
```

배지 표시.

예:

```text
TestA [테스트]
TestB [테스트]
```

---

# 10. 검색과 필터 조합

검색:

```text
아이 이름
로그인 ID
```

동작 순서:

```text
1. 내부 테스트 필터 적용
2. 검색 조건 적용
3. 정렬/페이지네이션
```

체크 해제 상태에서 테스트 아이 이름을 검색해도 결과에 나타나면 안 된다.

체크 후에는 검색 가능해야 한다.

---

# 11. KST 기준

오늘 참여 및 결과 집계는 기존:

```text
lib/analytics/kstDate.ts
toKSTDateStr()
getOffsetDateStr()
```

를 재사용한다.

UTC/local server timezone에 의존하는 새 날짜 계산을 만들지 않는다.

---

# 12. 재사용 컴포넌트

가능한 기존 컴포넌트 재사용:

```text
AdminResponsiveTable
AdminStatusBadge
```

테스트 표시:

```text
variant="neutral"
```

참여 완료:

```text
variant="success"
```

One-shot pending:

```text
variant="warning"
```

---

# 13. One-shot Override 보호

매우 중요.

테스트 계정 필터를 끄더라도:

```text
attendance_roulette_overrides
status = PENDING
```

데이터는 절대 변경하지 않는다.

필터는:

```text
보이기 / 숨기기
```

만 수행한다.

테스트 아이의 pending override가:

- 삭제
- 취소
- reset
- 다른 아이에게 이전

되면 실패다.

---

# 14. 황금열쇠 원장 보호

필터 ON/OFF는:

```text
gold_key_ledger
```

에 write를 발생시키면 안 된다.

금지:

- 재계산 write
- 원장 삭제
- balance update
- reward replay
- attendance 재지급

단순 read/filter만 수행한다.

---

# 15. 기존 룰렛 확률/설정 영향 금지

현재 룰렛 기본 정책 및 admin override 로직은 변경하지 않는다.

필터 추가 때문에:

- 룰렛 확률
- one-shot override
- 오늘 참여 상태
- 황금열쇠 지급
- 월 점수
- 퀴즈 점수

비즈니스 로직이 바뀌면 안 된다.

---

# 16. 통합 이벤트·보상 콘솔 호환

향후 `/admin/events-rewards` 통합 콘솔이 구현될 경우에도 동일 상태값을 재사용 가능하게 설계한다.

예:

```text
includeTestAccounts
```

를 출석 룰렛 탭 공통 state로 사용.

통합 전 독립 페이지에서도 동일 동작해야 한다.

---

# 17. Loading / Empty / Error

필터 변경 시:

```text
로딩 표시
```

결과 0명:

```text
조건에 맞는 아이가 없습니다.
```

API 오류:

```text
출석 룰렛 현황을 불러오지 못했습니다.
[다시 시도]
```

페이지 전체 client crash 금지.

---

# 18. 테스트 요구사항

## Case 1 기본값

```text
includeTestAccounts=false
```

기대:

- 테스트 아이 미노출
- KPI 테스트 계정 제외
- 결과 breakdown 테스트 계정 제외

## Case 2 포함 체크

```text
includeTestAccounts=true
```

기대:

- 실제 + 테스트 아이 모두 표시
- 테스트 아이 [테스트] badge
- KPI/결과 breakdown 모두 동일 모수

## Case 3 검색

테스트 아이 이름 검색:

- 체크 OFF → 0건
- 체크 ON → 검색됨

## Case 4 KPI 정합성

```text
대상 = 참여 + 미참여
```

항상 성립.

## Case 5 원장 보호

체크 ON/OFF 전후:

```text
gold_key_ledger row count 동일
attendance_roulette_overrides 동일
attendance_roulette_spins 동일
```

## Case 6 pending override

테스트 아이의 PENDING override가 체크 OFF 이후에도 DB에 그대로 유지.

## Case 7 Production

Production QA/Test 계정으로 visibility만 검증.

실제 아이 데이터 변경 0건.

---

# 19. 완료 조건

- 출석 룰렛에 `내부 테스트 계정 포함` 체크박스 존재
- 기본값 OFF
- `getTestFamilyIds()` 재사용
- `is_internal_test` 공식 판정 사용
- 상단 KPI 동일 필터 적용
- 오늘 결과 breakdown 동일 필터 적용
- 검색 동일 필터 적용
- 아이별 운영 목록 동일 필터 적용
- 월 점수/순위 동일 필터 적용
- 황금열쇠 보유량 동일 필터 적용
- 테스트 계정 [테스트] badge
- 원장 데이터 변경 0건
- One-shot Override 변경 0건
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 스모크 테스트 PASS

---

# 20. 완료 보고 형식

1. 기존 출석 룰렛 API/페이지 위치
2. 적용한 내부 테스트 판정 기준
3. 수정 파일
4. includeTestAccounts API 처리
5. KPI 필터 적용 결과
6. breakdown 필터 적용 결과
7. 목록/검색 필터 적용 결과
8. [테스트] badge
9. Production 실제/테스트 대상 수 비교
10. 원장 무변경 검증
11. Override 무변경 검증
12. TypeScript/Build
13. Dev E2E
14. Production 배포 커밋
15. Deployment ID / READY
16. Production 스모크 테스트
17. 남은 위험

---

# 21. 보안 및 제한

- `child_profiles.is_test_account`를 운영 테스트 필터 기준으로 사용 금지
- `is_internal_test` 원본 값을 임의 수정 금지
- 테스트 계정 숨김 시 DB row 삭제 금지
- gold_key_ledger write 금지
- attendance_roulette_spins write 금지
- attendance_roulette_overrides 상태 변경 금지
- 실제 사용자 보상/룰렛 설정 변경 금지
- Auth UUID 화면 노출 금지
- API Key/Token/Service Role Key 출력 금지
