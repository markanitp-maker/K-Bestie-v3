# Request: 관리자 Product Analytics / Retention 통합 대시보드 전면 재설계 v2
> 기존 `087-admin-product-analytics-retention-dashboard-redesign.md`를 대체하는 수정본

## 0. 최우선 원칙

이번 작업은 **현재 데이터가 부족하다는 이유로 분석 대시보드 구현을 중단하면 안 된다.**

반드시 아래 방식으로 진행한다.

```text
1. 현재 DB에서 정확히 계산 가능한 지표
→ 지금 즉시 대시보드에 구현

2. 대표가 필요로 하지만 현재 원천 데이터가 없는 지표
→ 이번 작업에서 향후 데이터가 쌓이도록 계측 구조를 추가

3. 신규 계측 배포 이전 과거 데이터
→ 추정/보간/소급 생성 금지

4. 데이터가 아직 충분하지 않은 지표
→ 0으로 표시하지 말고 `계측 중` / `데이터 축적 중` 표시

5. 충분한 데이터가 쌓이면
→ 동일 대시보드에서 자동 활성화
```

즉, **대시보드 구현과 신규 Analytics 계측 구축을 병렬로 진행한다.**

---

# 1. 최종 목적

이 화면은 단순 D1/D3/D7 리텐션 표가 아니다.

대표가 아래 질문에 한 화면에서 답할 수 있어야 한다.

```text
마케팅해서 몇 명을 데려왔는가?
→ 부모 몇 명이 가입했는가?
→ 아이 몇 명이 등록됐는가?
→ 가입한 부모/아이가 실제 다시 들어오는가?
→ 매일 오는가? 주 몇 회 오는가?
→ 들어와서 무엇을 하는가?
→ 어떤 메뉴/기능을 가장 많이 보는가?
→ 어디에서 시간을 가장 많이 쓰는가?
→ 어떤 기능을 사용하는 사람이 더 오래 남는가?
→ 어떤 유입 채널의 사용자가 더 오래 남는가?
→ 따라서 어떤 기능/마케팅 채널에 더 집중해야 하는가?
```

최종 분석 흐름:

```text
Acquisition
→ Signup
→ Visit
→ Engagement
→ Time
→ Retention
→ Product Value
→ Report Consumption
```

---

# 2. 벤치마킹 방향

UI/분석 철학은 다음 서비스를 조합한다.

## Amplitude
- Product Analytics
- Stickiness
- User Sessions
- Retention
- Lifecycle
- Journeys
- 기능 사용 그룹 비교

## GA4
- Acquisition
- First Touch / Signup Touch
- Acquisition → Engagement → Retention 연결

## Mixpanel
- Funnel
- Flow
- Drill-down

## PostHog
- Lifecycle
- Paths
- Retention

특정 제품 UI를 그대로 복제하지 않는다.

---

# 3. 내친구 케이 특화 분석축

반드시 아래를 별도 분석한다.

```text
부모 방문
아이 방문
부모+아이 같은 날 모두 방문한 가족
부모만 방문한 가족
아이만 방문한 가족
아무도 방문하지 않은 가족

부모 체류시간
아이 체류시간

아이 주요 행동
- 미션
- 자유대화
- 퀴즈
- 놀이

부모 주요 행동
- 일일 리포트
- 주간 리포트
- 부모-K 대화
- 아이에게 물어보기

아이 활동
↔ 부모 리포트 확인
↔ 가족 재방문
```

---

# 4. 최종 관리자 IA

```text
리포팅·분석
├─ 통합 분석 대시보드
└─ 리포팅 수동 실행

운영 도구
├─ 푸시 테스트
├─ 유입 링크 관리
└─ 휴지통
```

기존 운영 도구의 `회원가입 유입 현황`은 분석 기능이므로 통합 분석 대시보드의 `유입·가입` 영역으로 이동한다.

---

# 5. 통합 분석 대시보드 영역

```text
1. 유입·가입
2. 방문·재방문
3. 서비스 이용
4. 체류시간
5. 리텐션
6. 서비스 가치
7. 리포트 운영
```

---

# 6. 공통 필터

```text
[오늘] [최근7일] [최근14일] [최근30일] [이번달] [지난달] [직접기간]

[전체] [가족] [부모] [아이]

유입채널 [전체 ▼]

내부 테스트 [제외 ▼]
```

직접 기간:

```text
시작일 YYYY-MM-DD
종료일 YYYY-MM-DD
```

시간대:

```text
Asia/Seoul
```

모든 KPI / 차트 / 표 / CSV / XLSX에 동일 적용한다.

---

# 7. 현재 Production에서 즉시 사용할 수 있는 실제 데이터 원천

Antigravity 감사로 확인된 실제 원천:

```text
behavior_events
usage_events
chat_sessions
chat_messages
daily_reports
report_views
weekly_summaries
pipeline_jobs
quiz_attempts
parent_questions
child_profiles
parents
family_members
```

현재 데이터만으로 즉시 구현 가능한 분석:

```text
미션 시작/완료
미션 고유 사용자
미션 완료율
자유대화 세션/턴/이용시간
퀴즈 참여/점수/풀이시간
리포트 생성 성공/실패
일일 리포트 열람
가족별 핵심 활동
활동 리텐션
부모 질문 처리
파이프라인 성공률
가족별 최근 활동
```

이 기능들은 신규 방문 계측을 기다리지 말고 즉시 구현한다.

---

# 8. 현재 부족한 데이터는 이번 작업에서 앞으로 쌓이도록 구조 개선

현재 정확히 부족한 데이터:

```text
순수 앱 방문
아무 행동 없이 앱만 열었다 닫은 방문
앱 전체 체류시간
foreground/background 체류
idle 제외 Engaged Time
앱 세션 횟수
방문 → 핵심 행동 전환의 정확한 분모
```

이 데이터가 없다는 이유로 개발을 중단하지 않는다.

이번 작업에서 앞으로 데이터가 축적되도록 계측 구조를 추가한다.

---

# 9. 신규 Analytics 최소 계측

최소 아래 이벤트 또는 세션 정보를 수집한다.

```text
app_session_start
app_foreground
app_background
app_heartbeat
```

필요 시:

```text
app_session_end
page_view
```

추가.

## app_session_start
앱/PWA를 실제 열었을 때 기록.

아무 메뉴도 누르지 않아도 방문으로 인정.

## app_foreground
사용자가 앱을 실제 화면에 보고 있는 상태.

## app_background
앱이 background로 이동한 시점.

## app_heartbeat
foreground 상태의 체류를 측정.

권장 주기:

```text
30초
```

실제 부하를 측정해 조정 가능.

---

# 10. behavior_events 확장 vs app_sessions

Antigravity 감사 결과:

```text
behavior_events 확장
→ 단기 방문 계측에 적합

별도 app_sessions
→ 장기 정밀 체류시간에 더 적합
```

이번 구현 원칙:

### 방문 시작
기존 `behavior_events`의 `logBehaviorEvent()`를 최대한 재사용해 빠르게 계측 가능하게 한다.

예:

```text
app_session_start
app_foreground
app_background
page_view
```

### 정밀 체류시간
heartbeat 및 세션 단위 duration이 필요하므로 실제 구현 난이도/데이터량을 검토해 별도 `app_sessions` 구조를 도입해도 된다.

권장 필드:

```text
session_id
actor_type
actor_id
family_id
child_id nullable
started_at
last_heartbeat_at
ended_at nullable
foreground_duration_sec
route_at_start
environment
```

단, 동일 정보를 두 시스템에 무분별하게 중복 적재하지 않는다.

---

# 11. 방문 Source of Truth

절대 사용 금지:

```text
auth.users.last_sign_in_at
```

이유:

```text
Refresh Token 자동 갱신으로 실제 앱 방문 없이 값이 변경될 수 있음
```

신규 방문 기준:

```text
app_session_start
```

KST 날짜별 DISTINCT actor로 계산한다.

---

# 12. 신규 데이터의 과거 Backfill 금지

신규 방문/체류 계측 배포 이전 기간에는 실제 원천 데이터가 없다.

금지:

```text
auth.last_sign_in_at로 소급 추정
chat_session이 있으니 앱 방문했다고 전체 방문으로 소급 추정
임의 duration 생성
```

UI:

```text
계측 시작 전
데이터 없음
```

또는:

```text
2026-XX-XX부터 측정
```

표시.

---

# 13. 데이터 축적 중 지표 UI

예:

```text
D7 방문 리텐션
데이터 축적 중
D+4 / 7
```

```text
평균 앱 체류시간
계측 시작: 2026-XX-XX
```

미완성 데이터를 0으로 보여주지 않는다.

---

# 14. Executive KPI

상단은 5~6개만 유지.

권장:

```text
가입 부모
등록 아이
이번 주 방문 사용자
주 평균 방문일
평균 Engaged Time
D7 방문 리텐션
```

데이터가 없는 신규 지표는 `계측 중`.

---

# 15. 유입·가입

기존 회원가입 유입 현황을 이동.

Source:

```text
acquisition_links
acquisition_visits
acquisition_events
parent_attributions
```

표시:

```text
총 클릭
고유 방문
가입 시작
부모 가입 완료
아이 등록
가입 전환율
```

Attribution:

```text
First Touch
Signup Touch
```

---

# 16. 유입 채널별 사용자 품질

최종 목표:

| 채널 | 부모 가입 | 아이 등록 | D7 방문 | 주 평균 방문일 | 평균 체류 | 가장 많이 쓰는 기능 |
|---|---:|---:|---:|---:|---:|---|

신규 방문/체류 데이터 축적 전에는 가입/활동 기반 지표만 먼저 표시한다.

---

# 17. 방문·재방문

신규 계측 축적 후:

```text
오늘 방문 부모
오늘 방문 아이
부모+아이 모두 방문 가족
부모만 방문 가족
아이만 방문 가족
미방문 가족
```

---

# 18. DAU / WAU / MAU

```text
Parent DAU / WAU / MAU
Child DAU / WAU / MAU
```

전체 사용자:

```text
부모 user_id + 아이 child_id
```

독립 사용자로 계산.

가족 수와 혼동 금지.

---

# 19. Stickiness — 주 방문 빈도

최근 7일 distinct 방문일 기준.

```text
주 1회 이하
주 2~3회
주 4~6회
매일
```

부모/아이 별도.

---

# 20. Lifecycle

```text
신규
계속 사용
복귀
휴면
```

정의:

```text
신규 = 이번 기간 첫 방문
계속 사용 = 직전/현재 기간 모두 방문
복귀 = 직전 기간 미방문 후 다시 방문
휴면 = 과거 방문했지만 현재 기간 미방문
```

---

# 21. 서비스 이용 — 아이

현재 데이터로 즉시 구현.

기능:

```text
미션
자유대화
퀴즈
놀이
```

각 기능:

```text
고유 사용자
이용 횟수
이용률
완료율
평균 이용시간
```

실제 계측되는 기능만 노출.

---

# 22. 서비스 이용 — 부모

현재 데이터로 즉시 구현.

```text
일일 리포트
주간 리포트
대화 주제/클루
아이에게 물어보기
부모-K 대화
```

각 기능:

```text
고유 사용자
이용 횟수
이용률
```

체류시간은 정확한 데이터가 쌓이는 시점부터 표시.

---

# 23. 방문 → 활동 전환

신규 app_session_start 이후부터 정확하게 계산.

```text
방문 O / 핵심 활동 O
방문 O / 핵심 활동 X
미방문
```

계측 전 과거 데이터에는 표시하지 않는다.

---

# 24. 체류시간

신규 계측 축적 후:

```text
총 체류시간
1인당 평균 체류
평균 세션시간
주 평균 세션 수
```

부모/아이 별도.

---

# 25. 기능별 체류시간

현재 이미 정확한 duration이 있는 기능은 즉시 표시.

```text
미션
자유대화
퀴즈
```

전체 앱 대비 체류 비중은 신규 app session 데이터 축적 후 계산.

---

# 26. 방문 리텐션

신규 방문 계측 기반:

```text
D1
D3
D7
D14
W2
W4
```

정의:

```text
가입/기준일 이후 해당 날짜에 앱을 실제 다시 열었는가
```

---

# 27. 활동 리텐션

현재 데이터로 즉시 구현 가능.

핵심 행동 예:

아이:
```text
mission_start/complete
freechat
quiz
play
```

부모:
```text
report_view
parent_k
parent_question
```

지표:

```text
D1
D3
D7
D14
W2
W4
```

---

# 28. 미완성 코호트 처리

아직 도달하지 않은 날짜:

```text
-
```

또는:

```text
데이터 축적 중
```

0% 표시 금지.

---

# 29. 서비스 가치 분석

대표가 어디에 더 투자할지 판단하는 핵심 영역.

| 기능 | 이용자 | 이용률 | 평균 이용시간 | 주 평균 방문 | D7 | D14 | W2 |
|---|---:|---:|---:|---:|---:|---:|---:|

현재 가능한 값은 즉시 표시.

방문/전체 체류 기반 값은 신규 계측 축적 후 자동 활성화.

표현:

```text
기능 사용 그룹 비교
```

인과관계로 단정하지 않는다.

---

# 30. 일일 리포트 열람 Source of Truth 수정

Antigravity 추가 감사로 확정:

```text
daily_reports.viewed_at
→ 실제로 어디에서도 UPDATE하지 않음
→ 사실상 미사용 컬럼
```

따라서 분석에서:

```text
daily_reports.viewed_at
```

을 열람 Source of Truth로 사용 금지.

일일 리포트 실제 열람 기준:

```text
report_views
```

정확한 흐름:

```text
부모 /parent/report/[id] 진입
→ POST /api/parent/reports/[id]/viewed
→ report_views INSERT
→ behavior_events parent_report_view
```

---

# 31. daily_reports.viewed_at 처리 정책

이번 작업에서 두 선택지 중 하나를 확정해 일관되게 처리한다.

권장안:

```text
report_views를 유일한 Source of Truth로 유지
daily_reports.viewed_at는 deprecated 표시 후 신규 코드에서 사용하지 않음
```

불필요하게 report_views와 daily_reports.viewed_at를 이중 관리하지 않는다.

컬럼 제거는 별도 안전성 확인 없이는 하지 않는다.

---

# 32. 주간 리포트 열람 계측 개선

현재 주간 리포트는:

```text
behavior_events
event_name = parent_report_view
feature = weekly_report
```

로 기록.

전용 `report_views` INSERT는 없다.

분석은 당장 behavior_events로 가능하나, 일일/주간 열람 Source 구조를 통일할지 검토한다.

권장:

```text
report_views에 report_type = daily | weekly
```

형태로 확장 가능 여부를 검토.

현재 schema와 충돌하면 별도 안전 구조를 설계.

핵심은 앞으로:

```text
일일 리포트 열람
주간 리포트 열람
```

이 확실히 구분되어야 한다.

---

# 33. 리포트 생성 → 열람 Funnel

즉시 구현.

```text
리포트 생성
→ 부모 열람
```

일일:

```text
daily_reports
+
report_views
```

주간:

```text
weekly_summaries
+
behavior_events(feature=weekly_report)
```

표시:

```text
생성
열람
미열람
열람률
최초 열람까지 시간
```

가능한 데이터만 정확히 표시.

---

# 34. 리포팅 Pipeline

현재 즉시 구현.

Source:

```text
pipeline_jobs
```

단계:

```text
1차 수집
2차 수집
Context Correction
Memory Batch
Daily Report
Weekly Report
```

표시:

```text
대상
성공
실패
대기
성공률
평균 처리시간
재시도
에러코드
```

---

# 35. 가족 단위 분석

현재 가능한 활동 기반 값은 즉시 구현.

신규 방문/체류 계측 후 확장.

가족별:

```text
부모 최근 활동
아이 최근 활동
부모 핵심 행동
아이 핵심 행동
미션/자유대화
리포트 열람
```

향후:

```text
부모 방문일
아이 방문일
동시 방문일
부모 체류
아이 체류
```

자동 추가.

---

# 36. Drill-down

```text
[가족] [부모] [아이]
```

행 클릭 → Drawer.

현재 데이터와 신규 계측 데이터를 함께 보여준다.

---

# 37. 내부 테스트

공식:

```text
is_internal_test
getTestFamilyIds()
```

재사용.

기본 제외.

---

# 38. KST

모든 기간 계산:

```text
Asia/Seoul
```

공통 helper.

---

# 39. 기존 API 재사용

먼저 확인:

```text
/api/admin/analytics
/api/admin/retention
/api/admin/usage
/api/admin/operationsConsole
```

기존 로직 중 정확한 것은 재사용.

잘못된 `last_sign_in_at` 기반 방문 계산이 있으면 제거.

---

# 40. 신규 API/RPC

필요한 경우에만 추가.

예:

```text
analytics visits
analytics sessions
analytics stickiness
analytics lifecycle
analytics product-value
analytics reports
```

N+1 금지.

---

# 41. UI 디자인 원칙

- 상단 KPI 5~6개
- 큰 카드 남발 금지
- 질문별 섹션
- 차트 + 보조 테이블
- 중복 숫자 반복 금지
- 상세는 Drawer
- "0"과 "데이터 없음/계측 중"을 구분

---

# 42. 핵심 차트

```text
유입 Funnel
DAU/WAU 추이
Stickiness
Lifecycle
아이/부모 기능 이용
기능별 체류시간
방문 Retention
활동 Retention
서비스 가치 비교
리포트 Pipeline
```

---

# 43. Export

CSV/XLSX.

권장 sheet:

```text
Summary
Acquisition
Visits
Engagement
Sessions
Retention
Product Value
Reports
Families
Parents
Children
```

신규 계측 전 빈 값은 0으로 강제 변환하지 않는다.

---

# 44. Phase 1 — 즉시 구현

신규 계측을 기다리지 않고 바로 구현:

```text
유입·가입
아이 미션/자유대화/퀴즈
부모 리포트/질문/K대화
활동 리텐션
리포트 생성→열람
리포팅 파이프라인
가족 활동 요약
서비스 가치의 현재 계산 가능 지표
```

동시에 신규 방문/체류 계측 배포.

---

# 45. Phase 2 — 데이터 축적 후 자동 활성화

신규 계측 데이터가 쌓이는 즉시:

```text
순수 방문 DAU/WAU/MAU
Stickiness
Lifecycle
방문→활동 전환
전체 앱 체류시간
Engaged Time
방문 리텐션
채널별 방문 리텐션
가족별 부모/아이 방문
```

활성화.

기능 구현 자체를 7일 뒤로 미루지 말고, 데이터 부족 시 `계측 중` 상태로 준비해 둔다.

---

# 46. 테스트

### 방문
- 앱 실행만 함 → 방문 O
- 아무 행동 없음 → 활동 X
- auth refresh만 발생 → 방문 X

### 체류
- foreground만 count
- background 제외
- heartbeat timeout 이후 idle 제외

### 활동
기존 세션/behavior 데이터와 일치.

### 리포트
- 일일 report_views 기준
- 주간 feature=weekly_report 기준
- daily_reports.viewed_at 사용 0건

### 신규 계측 전 기간
- 0% 표시 금지
- `계측 전` 표시

---

# 47. 완료 조건

- 계측 부족 때문에 전체 대시보드 구현 중단하지 않음
- 현재 계산 가능한 지표 즉시 구현
- 부족한 데이터는 앞으로 쌓이도록 계측 구조 추가
- 과거 데이터 추정/backfill 금지
- 방문 Source = app_session_start
- auth.last_sign_in_at 방문 사용 0건
- app_foreground/background 계측
- heartbeat 계측
- 활동 리텐션 즉시 구현
- 방문 리텐션 구조 구현 및 데이터 축적 중 표시
- Stickiness 구조 구현
- Lifecycle 구조 구현
- 기능별 이용 분석
- 기능별 기존 duration 표시
- 전체 Engaged Time 구조 구현
- Acquisition → Retention 연결
- 서비스 가치 분석
- 일일 리포트 열람 = report_views
- daily_reports.viewed_at 분석 사용 0건
- 일일/주간 리포트 열람 구분
- Pipeline 운영 분석
- 가족/부모/아이 Drill-down
- 내부 테스트 기본 제외
- KST 통일
- CSV/XLSX
- TypeScript 오류 0
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production smoke PASS

---

# 48. 완료 보고

1. 현재 즉시 구현한 지표
2. 신규로 계측하기 시작한 지표
3. 신규 Analytics 이벤트
4. app session 저장 구조
5. 방문 Source of Truth
6. 체류시간 계산 방식
7. 계측 시작일
8. 과거 데이터 처리 방식
9. Acquisition 분석
10. Stickiness/Lifecycle
11. 아이 기능 분석
12. 부모 기능 분석
13. 활동 Retention
14. 방문 Retention 준비 상태
15. 서비스 가치 분석
16. report_views 적용
17. weekly report view 구분
18. pipeline 분석
19. 가족 분석
20. 기존 API 재사용
21. 신규 API/RPC
22. TypeScript/Build
23. Dev E2E
24. Production 배포 커밋
25. Deployment ID/READY
26. Production smoke
27. 아직 데이터 축적 중인 KPI

---

# 49. 보안/개인정보 제한

- 대화 원문 분석 화면 노출 금지
- heartbeat에 입력 내용 저장 금지
- page content 저장 금지
- Secret/API Key/Token 출력 금지
- UUID 기본 노출 금지
- 분석 목적 이상의 개인정보 신규 수집 금지
- 실제 사용자/내부 테스트 데이터 혼합 금지
