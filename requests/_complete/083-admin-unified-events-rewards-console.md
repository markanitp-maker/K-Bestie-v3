# Request: 관리자 `이벤트·보상` 통합 운영 콘솔 구축 — 개요 / 미션 30일 / 퀴즈 리더보드 / 출석 룰렛 / 지급 관리

## 0. 작업 목적

현재 관리자 `이벤트·보상` 영역은 아래 기능이 각각 분리되어 있어 이벤트 운영 흐름을 한눈에 파악하기 어렵다.

```text
이벤트 현황
미션 이벤트
퀴즈 리더보드
출석 룰렛
상품권 지급 관리
```

이번 작업에서는 이를 하나의 통합 운영 콘솔로 재구성한다.

최종 목표는 아래 흐름을 한 페이지 안에서 자연스럽게 연결하는 것이다.

```text
이벤트 참여
→ 진행/점수/달성 현황
→ 보상 대상 확정
→ 지급 승인
→ 오프라인 전달
→ 전달 완료 기록
```

통합 라우트:

```text
/admin/events-rewards
```

---

# 1. 구현 전 반드시 현재 HEAD 재확인

Antigravity 최신 감사에서는 출석 룰렛 전용 테이블/API/UI가 아직 미구현이라고 보고했으나, 실제 Production 관리자 스크린샷에는 이미 `출석 룰렛` 운영 화면이 존재한다.

따라서 작업 시작 전에 반드시 현재 HEAD와 Production 배포 코드를 다시 확인한다.

확인 대상:

```text
AttendanceRoulette 관련 컴포넌트
/api/admin/events/attendance-roulette
attendance_roulette_days
attendance_roulette_spins
attendance_roulette_overrides
gold_key_ledger
```

원칙:

- 이미 구현돼 있으면 기존 구현을 재사용
- 같은 이름/역할의 테이블/API를 중복 생성하지 않음
- 실제 현재 코드가 감사 보고보다 최신이면 현재 HEAD를 source of truth로 사용
- 감사 보고와 코드가 충돌하면 완료 보고에 차이를 명시

---

# 2. 최종 관리자 IA

사이드바 `이벤트·보상` 영역은 최종적으로 하나의 진입점으로 정리한다.

```text
이벤트·보상
```

클릭:

```text
/admin/events-rewards
```

페이지 내부 탭:

```text
[개요] [미션 30일] [퀴즈 리더보드] [출석 룰렛] [지급 관리]
```

query 예:

```text
/admin/events-rewards?tab=overview
/admin/events-rewards?tab=missions
/admin/events-rewards?tab=leaderboard
/admin/events-rewards?tab=attendance
/admin/events-rewards?tab=fulfillments
```

기본:

```text
overview
```

---

# 3. 기존 라우트 호환

Antigravity 감사 기준 기존 라우트/탭:

```text
/admin?page=events-overview
/admin?page=events-mission-onboarding
/admin?page=events-quiz-leaderboard
/admin?page=events-reward-fulfillments
```

통합 후:

```text
/admin?page=events-overview
→ /admin/events-rewards?tab=overview

/admin?page=events-mission-onboarding
→ /admin/events-rewards?tab=missions

/admin?page=events-quiz-leaderboard
→ /admin/events-rewards?tab=leaderboard

/admin?page=events-reward-fulfillments
→ /admin/events-rewards?tab=fulfillments
```

출석 룰렛의 실제 현재 라우트가 존재하면:

```text
→ /admin/events-rewards?tab=attendance
```

로 redirect.

존재하지 않는 라우트를 추측해 추가하지 않는다.

---

# 4. 공통 상단 필터

탭 전체에서 공통으로 사용할 수 있는 필터는 하나의 상단 필터바로 통일한다.

권장:

```text
[아이 이름/로그인 ID 검색.....................]

☐ 내부 테스트 계정 포함
```

탭별 추가 필터:

- 미션 30일: 상태
- 퀴즈 리더보드: 월
- 출석 룰렛: 오늘 참여 상태
- 지급 관리: 지급 상태 / 이벤트 출처

내부 테스트 기본값:

```text
false
```

즉 기본 화면은 실제 사용자만 표시한다.

기존 `getTestFamilyIds(service)` 또는 현재 공통 internal-test helper를 재사용한다.

---

# 5. 사용자 표시 원칙

현재 일부 이벤트 화면에서 이름이 없을 경우:

```text
child_id.slice(0, 8)
```

형태로 UUID 일부가 노출되고 있다.

이번 개편에서는 사용자-facing UUID 노출을 제거한다.

표시:

```text
아이 이름
로그인 아이디
가족명
```

예:

```text
박서아
psa160202
서둥이네 가족
```

내부 테스트 계정:

```text
[테스트]
```

neutral badge 표시.

아이 이름/로그인 ID/가족명 조인을 공통 helper 또는 서버 DTO로 통일한다.

---

# 6. `개요` 탭 목적

`개요`는 이벤트 관련 주요 운영 상태를 빠르게 파악하는 대시보드다.

기존처럼 12개의 큰 KPI 카드만 나열하지 않는다.

권장 구조:

```text
이벤트·보상 개요

[미션 진행 중] [7일 내 종료] [오늘 출석 참여] [지급 대기] [예상 지급액]

미션 30일 요약
퀴즈 리더보드 TOP3
출석 룰렛 오늘 현황
보상 지급 현황
```

---

# 7. 개요 KPI 카드

권장 상단 핵심 KPI 5개:

```text
미션 진행 중
7일 내 종료
오늘 출석 참여
지급 대기
예상 총 지급액
```

필요 시 두 번째 행에 작은 summary card:

```text
퀴즈 실제 참가자
오늘 룰렛 미참여
전달 예정
전달 완료
```

카드를 너무 많이 만들지 않는다.

---

# 8. 미션 예상 총 지급액 오류 수정

Antigravity 감사 결과 현재 `이벤트 현황`의 예상 총 지급액이:

```text
final_reward_amount
```

만 합산하고 있어 진행 중 이벤트의 예상 보상이 0원으로 잡힐 수 있다.

수정 정의:

## active

```text
current_reward_amount
```

사용.

## completed / max_completed

```text
final_reward_amount
```

사용.

예상 총 지급액:

```text
SUM(
  active ? current_reward_amount
         : final_reward_amount
)
```

단, 이미 fulfillment가 생성되어 취소/보류/전달완료 상태인 경우 이중 계산되지 않도록 실제 비즈니스 흐름을 확인한다.

---

# 9. 미션 구간 KPI 표현 개선

현재:

```text
10회 달성
30회 달성
50회 달성
60회 달성
```

은 누적 조건이라 60회 달성자가 4개 카드에 모두 포함된다.

잘못된 계산은 아니지만 운영자가 현재 분포로 오해할 수 있다.

따라서 UI 명칭을 아래처럼 바꾼다.

```text
10회 이상
30회 이상
50회 이상
60회 달성
```

또는 별도 `현재 구간 분포`를 추가:

```text
0~9
10~29
30~49
50~59
60
```

둘을 동시에 과도하게 보여주지 말고, 개요에는 `현재 구간 분포`를 우선 권장한다.

---

# 10. `미션 30일` 탭

기존:

```text
MissionOnboardingEventsTab
```

기능을 통합한다.

Source of Truth:

```text
child_mission_onboarding_events
child_mission_event_completions
child_profiles
```

실제 상태:

```text
active
max_completed
completed
```

---

# 11. 미션 30일 목록

검색:

```text
아이 이름
로그인 ID
```

필터:

```text
전체
진행 중
60회 달성
종료
7일 내 종료
```

권장 컬럼:

| 아이 | 상태 | 최초 미션 완료 | 종료 예정 | 완료 횟수 | 현재 구간 | 예상/확정 보상 |
|---|---|---|---|---:|---|---:|

완료 횟수:

```text
N / 60
```

현재 구간:

```text
0원
1,000원
3,000원
5,000원
10,000원
```

---

# 12. 미션 이벤트 정책 보호

현재 정책:

```text
10회  → 1,000원
30회  → 3,000원
50회  → 5,000원
60회  → 10,000원
```

아이당 생애 1회:

```text
UNIQUE(environment, child_id)
```

유지.

미션 완료 멱등성:

```text
(event_id, mission_session_id)
```

유지.

이번 관리자 UI 통합으로 이벤트 카운트/보상 비즈니스 로직을 변경하지 않는다.

---

# 13. 미션 상세 Drawer

행 클릭:

```text
→ AdminDrawer
```

표시:

```text
아이
로그인 ID
가족
부모
시작일
종료 예정일
완료 횟수
현재 보상 구간
종료 상태
최종 보상
최근 미션 완료 이력
```

링크:

```text
[사용자 관리에서 보기]
```

---

# 14. `퀴즈 리더보드` 탭

기존:

```text
QuizLeaderboardEventsTab
```

기능 재사용.

상단:

```text
[2026-08] [2026-09] ...
```

또는 월 select.

기본 월:

```text
현재 월
```

---

# 15. 퀴즈 리더보드 구조

Source of Truth:

진행 중:

```text
quiz_monthly_leaderboard_aggregates
quiz_leaderboard
```

마감:

```text
quiz_leaderboard_final_snapshots
quiz_leaderboard_final_entries
```

더미:

```text
is_seed_user = true
reward_eligible = false
```

더미는 순위 화면에는 표시 가능하지만 보상 대상에는 포함하지 않는다.

---

# 16. 퀴즈 TOP3 요약

탭 상단에 실제 reward eligible 아이 TOP3를 카드 또는 compact row로 강조한다.

```text
1위
아이 이름
점수
5,000원

2위
...
3,000원

3위
...
1,000원
```

더미가 상위에 있어도 TOP3 보상 대상에서는 제외.

`reward_eligible=true` 기준.

---

# 17. 퀴즈 순위표

권장 컬럼:

```text
순위
아이
점수
정답 수
완료 세션 수
실제/더미
보상 자격
예상 상품권
```

더미:

```text
[더미]
지급대상 아님
```

명확히 표시.

현재 4단계 tie-break 정렬 로직은 변경하지 않는다.

---

# 18. 퀴즈 마감/보상 연결

월말 확정 후:

```text
event_reward_fulfillments
event_type = quiz_leaderboard
```

연결 구조 유지.

통합 UI에서는 리더보드에서:

```text
[지급 관리에서 보기]
```

로 해당 fulfillment 탭을 열 수 있게 한다.

---

# 19. `출석 룰렛` 탭

현재 실제 구현 여부를 HEAD에서 먼저 확인한다.

이미 구현됐다면 기존 화면과 082 Request의 내부 테스트 필터를 재사용한다.

구현이 정말 없다면 기존 승인된 출석 룰렛 Request를 기준으로 구현하되 중복 migration 금지.

---

# 20. 출석 룰렛 기본 정책

확정 정책:

```text
황금열쇠 +1: 80%
한번 더: 20%
꽝/+3/+5/+7/+9: 기본 0%
```

관리자 one-shot override:

```text
특정 아이의 "다음 1회 결과"를 강제 지정
```

pending은 실제 spin 성공 전까지 유지.

---

# 21. 출석 룰렛 상단 KPI

기존 화면 기능 유지:

```text
대상 아이
오늘 참여
오늘 미참여
오늘 지급 열쇠
```

오늘 결과별 횟수:

```text
꽝
한번 더
+1
+3
+5
+7
+9
```

내부 테스트 필터를 모든 KPI/표에 동일 적용.

---

# 22. 출석 룰렛 목록

권장 컬럼:

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

기존 기능 유지.

테스트 아이 포함 시:

```text
[테스트]
```

배지.

---

# 23. One-shot Override 보호

통합 콘솔 이동 때문에 override가 손실되면 안 된다.

원칙:

```text
필터 OFF/ON
탭 이동
페이지 reload
```

가 DB 상태에 영향을 주지 않음.

`PENDING`은 실제 spin + ledger 지급 성공 시에만 `CONSUMED`.

---

# 24. `지급 관리` 탭

기존:

```text
RewardFulfillmentsTab
```

재사용.

Source of Truth:

```text
event_reward_fulfillments
```

실제 상태:

```text
pending
approved
scheduled
delivered
on_hold
cancelled
```

---

# 25. 지급 관리 UI 문구 수정

현재 운영은 자동 발송이 아니다.

따라서 `발송 완료` 같은 표현보다:

```text
전달 완료
```

를 사용한다.

상태 표시:

```text
지급 대상 확인
승인
전달 예정
전달 완료
보류
취소
```

---

# 26. 지급 관리 필터

상단:

```text
[전체]
[지급 대상 확인]
[승인]
[전달 예정]
[전달 완료]
[보류]
[취소]
```

추가:

```text
이벤트 출처
- 미션 30일
- 퀴즈 리더보드
- 기타
```

검색:

```text
아이 이름 / 로그인 ID
```

---

# 27. 지급 목록 컬럼

권장:

| 아이 | 가족/부모 | 이벤트 출처 | 보상 기준 | 지급 금액 | 상태 | 예정일/완료일 |
|---|---|---|---|---:|---|---|

행 클릭:

```text
→ 지급 상세 Drawer
```

---

# 28. 지급 상세 Drawer

표시:

```text
아이
로그인 ID
가족
부모
이벤트 출처
달성 내용
확정 금액
현재 상태
관리자 메모
전달 예정일
전달 완료일
상태 변경 이력
```

액션:

```text
승인
전달 예정
전달 완료
보류
취소
```

현재 허용 전이 규칙을 그대로 재사용한다.

---

# 29. 오프라인 지급 원칙 명시

실제 구조:

```text
delivery_method = offline
```

따라서 관리자 화면 상단 안내:

```text
상품권은 자동 발송되지 않습니다.
오프라인 전달 후 관리자에서 '전달 완료'로 기록합니다.
```

자동 기프티콘 API를 새로 만들지 않는다.

---

# 30. 개요 — 지급 현황

개요 탭 하단에 compact 지급 현황을 표시한다.

```text
지급 대상 확인
승인
전달 예정
전달 완료
보류
```

`취소`는 운영 backlog KPI에서는 별도로 강조할 필요 없음.

클릭 시:

```text
?tab=fulfillments&status=...
```

로 이동.

---

# 31. 개요 — 퀴즈 요약

개요에 현재 월 실제 TOP3만 compact 표시.

예:

```text
퀴즈 리더보드 2026-08

1. 안서아 880점
2. 안서현 720점
3. 윤도원 610점
```

더미 제외.

---

# 32. 개요 — 출석 요약

오늘 기준:

```text
대상
참여
미참여
지급 열쇠
```

내부 테스트 기본 제외.

---

# 33. 공통 사용자 Drill-down

모든 탭에서 아이를 클릭하면:

```text
/admin/users?tab=children
```

통합 사용자 관리와 연결.

가능하면 선택 아이 context를 query/state로 전달.

가족/부모도 상세 Drawer에서 이동 가능.

---

# 34. 공통 내부 테스트 필터

기본:

```text
내부 테스트 계정 제외
```

체크:

```text
☐ 내부 테스트 계정 포함
```

적용 대상:

- 개요
- 미션 30일
- 퀴즈 리더보드 실제 사용자 통계
- 출석 룰렛
- 지급 관리

단, 퀴즈 `더미`는 internal-test 계정과 별개다.

구분:

```text
내부 테스트 사용자
퀴즈 시드 더미
```

를 혼동하지 않는다.

---

# 35. 환경 격리

현재 주요 이벤트 테이블은:

```text
environment = development | production
```

으로 격리돼 있다.

Production 관리자에서는 Production row만 조회.

Dev 데이터가 Production KPI에 섞이면 실패.

---

# 36. 소프트 삭제

현재 soft-delete가 적용된 resource만 그대로 유지한다.

특히:

```text
event_reward_fulfillments.deleted_at
```

재사용.

미션 이벤트 원장/퀴즈 원장/출석 원장에 기존 soft-delete 정책이 없다면 통합 UI를 이유로 새 삭제 기능을 추가하지 않는다.

원장성 데이터는 임의 삭제 버튼 제공 금지.

---

# 37. 감사 로그

지급 상태 변경과 override 설정 등 기존 감사 가능 action은 유지한다.

최소 기록:

```text
관리자
대상 아이
action
before
after
timestamp
request_id
```

Secret/UUID 전체값은 UI에 노출하지 않는다.

---

# 38. 공통 컴포넌트 재사용

재사용 우선:

```text
AdminResponsiveTable
AdminFilterBar
AdminStatusBadge
AdminDrawer
useAdminSoftDelete
```

각 탭마다 비슷한 검색/상태 버튼 UI를 새로 복제하지 않는다.

---

# 39. 모바일

모바일:

- 상단 5탭 가로 스크롤 또는 select
- KPI 2열/1열
- 테이블은 AdminResponsiveTable 카드형
- Drawer는 full-screen
- 긴 로그인 ID 말줄임
- 상태 액션은 overflow menu 가능

---

# 40. 오류 격리

개요에서 한 API가 실패해도 전체 페이지가 crash하지 않게 한다.

예:

```text
퀴즈 API 실패
→ 퀴즈 요약만 오류 표시

출석 API 실패
→ 출석 요약만 오류 표시
```

다른 탭/섹션은 정상 유지.

---

# 41. 테스트 요구사항

## 개요

- 미션 진행 중
- 7일 내 종료
- 오늘 출석 참여
- 지급 대기
- 예상 총 지급액

DB/API와 비교.

## 미션

- 10/30/50/60 보상 구간
- 30일 종료
- max_completed
- 아이당 1회
- 내부 테스트 필터

## 퀴즈

- 월 변경
- 실제 사용자
- 더미
- reward_eligible
- TOP3
- 최종 스냅샷

## 출석

- 기본 확률
- 오늘 참여
- 결과 breakdown
- one-shot pending
- 내부 테스트 필터
- ledger 무변경

## 지급

- pending
- approved
- scheduled
- delivered
- on_hold
- cancelled
- 오프라인 전달
- 상태 전이

---

# 42. Production 데이터 보호

Production QA는 기존 QA 계정만 사용한다.

새 Auth/가족 생성 금지.

실제 사용자:

- 미션 상태 변경 금지
- 퀴즈 점수 변경 금지
- 출석 override 설정 금지
- 지급 상태 변경 금지

QA 계정 또는 read-only 검증만 사용.

---

# 43. E2E 시나리오

1. `/admin/events-rewards`
2. 개요 KPI 확인
3. 미션 30일 탭
4. 아이 검색
5. 7일 내 종료 필터
6. 퀴즈 월 변경
7. 더미/실사용자 표시
8. TOP3 확인
9. 출석 룰렛 탭
10. 내부 테스트 포함 ON/OFF
11. 지급 관리
12. 상태 필터
13. 사용자 관리 drill-down
14. 기존 URL redirect
15. 모바일 tab 이동
16. Browser Console 오류 0

---

# 44. 완료 조건

- `/admin/events-rewards` 실제 구현
- 5개 탭 구현
- 사이드바 이벤트·보상 1개 진입점
- 기존 4개 이상 이벤트 라우트 redirect
- 개요 KPI 정리
- 예상 미션 지급액 계산 수정
- 미션 구간 표현 개선
- 미션 30일 기존 로직 유지
- 퀴즈 TOP3 실제 사용자 기준
- 더미 보상 제외
- 출석 룰렛 기존/최신 구현 재사용
- 내부 테스트 필터
- one-shot override 보존
- 지급 관리 오프라인 워크플로우 유지
- `발송 완료` → `전달 완료` 표현
- 사용자 UUID 기본 노출 0건
- 이름 + 로그인 ID + 가족 표시
- 사용자 관리 drill-down
- Dev/Production environment 격리
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 스모크 테스트 PASS
- 실제 사용자 데이터 변경 0건

---

# 45. 완료 보고 형식

1. 기존 5개 화면 구조
2. 감사와 현재 HEAD 출석 룰렛 차이
3. 최종 통합 IA
4. `/admin/events-rewards` 구현 파일
5. 기존 라우트 redirect
6. 개요 KPI 계산식
7. 예상 지급액 before → after
8. 미션 30일 재사용 구조
9. 퀴즈/더미/TOP3 구조
10. 출석 룰렛 재사용/구현 구조
11. internal-test 필터
12. 지급 상태/오프라인 전달
13. 사용자 조인/UUID 제거
14. 공통 컴포넌트
15. Environment 격리
16. TypeScript/Build
17. Dev E2E
18. Production 배포 커밋
19. Deployment ID / READY
20. Production 스모크 테스트
21. 남은 위험

---

# 46. 보안 및 작업 제한

- 이벤트 원장 임의 삭제 금지
- 실제 사용자 이벤트 진행값 수정 금지
- 퀴즈 더미를 내부 테스트 계정으로 혼동 금지
- reward_eligible=false 더미에게 지급 생성 금지
- one-shot pending 임의 소진/삭제 금지
- gold_key_ledger 임의 수정 금지
- 자동 상품권 발송 API 신설 금지
- UUID 사용자-facing 노출 금지
- Service Role Key/API Key/Token 출력 금지
- 감사 결과만 믿고 중복 출석 룰렛 테이블/API 생성 금지 — 현재 HEAD 먼저 확인
