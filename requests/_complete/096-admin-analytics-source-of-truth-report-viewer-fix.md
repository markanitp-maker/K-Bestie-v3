# 관리자 통합 분석 대시보드 Source of Truth 정합성 및 부모별 리포트 열람 추적 정상화

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
현재 관리자 `리포팅·분석 > 통합 분석 대시보드`는 일부 KPI/퍼널/부모별 분석이 서로 다른 단위와 Source of Truth를 혼용해 잘못 표시된다.

작업 완료 후:
```text
1. 사용자 행동 퍼널과 리포팅 파이프라인을 서로 다른 단위로 분리
2. 퍼널/품질 지표에서 100% 초과 값 0건
3. V3 미션 완료는 mission_progress.status='COMPLETED' 기준으로 정상 집계
4. 리포트 생성률은 실제 daily_reports 생성 고유 슬롯 / 실제 대상 슬롯 기준
5. 일일 리포트 열람률은 report_views의 고유 report_id / 생성된 고유 report_id 기준
6. 부모별 리포트 열람은 실제 viewer_id 기준으로 각각 분리
7. 엄마가 본 리포트를 아빠도 본 것처럼 복사 표시하는 현상 제거
8. 과거 viewer_id 없는 데이터는 소급 추정하지 않고 '계측 시작 전/가족 단위 과거 데이터'로 처리
9. 주간 리포트도 부모별 viewer를 식별할 수 있도록 일관된 열람 추적 구조 적용
10. 17:55 collection_1 레거시 분석 표시는 094 정책과 정합
11. 기간/대상/내부 테스트/CSV/XLSX 필터 동작은 기존 정상 상태 유지
```

### 대표님 테스트 정상 프로세스
1. 관리자 `통합 분석 대시보드` 진입
2. 최근 30일 선택
3. 행동 퍼널에서 100%를 초과하는 값이 없는지 확인
4. 실제 V3 미션 완료 아이가 `미션 완료` 집계에 반영되는지 확인
5. 리포트 생성률이 동일 기간의 실제 생성/대상 수와 맞는지 확인
6. 일일 리포트 열람률이 `열람된 고유 리포트 / 생성된 고유 리포트` 기준으로 표시되는지 확인
7. 다중 보호자 가족에서 엄마/아빠 각각의 실제 열람 수가 다르게 표시되는지 확인
8. 과거 `viewer_id IS NULL` 데이터가 특정 부모에게 임의 귀속되지 않는지 확인
9. 부모별 분석의 기존 `report_views에 viewer_id가 없어 부모 열람은 가족 단위로 표시합니다.` 상시 경고가 제거되거나 과거 데이터 안내로만 제한되는지 확인
10. CSV/XLSX Export가 현재 화면 값과 동일한지 확인

PASS:
```text
- 100% 초과 계산 0건
- V3 미션 완료 0건 오표시 제거
- report_views 기반 일일 리포트 열람률 정상화
- 부모별 실제 viewer 분리
- 과거 데이터 임의 귀속 0건
- 신규 열람부터 정확한 부모별 통계 축적
- 기간/대상/내부테스트/export 회귀 없음
```

## 1. 상태 / 우선순위 / 대상
- 상태: 구현 요청
- 우선순위: P0 + P1
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code
- 적용 대상:
  - 관리자 `통합 분석 대시보드`
  - 행동 퍼널
  - 리포팅 파이프라인/품질
  - 상단 미션 완료율
  - 상세 Drill-down
  - 아이별 분석
  - 부모별 분석
  - 일일/주간 리포트 열람 계측
  - `report_views`
  - 관련 Admin Analytics API
- 제외 대상:
  - 정상 동작 중인 D1/D3/D7 코호트 계산식의 불필요한 변경
  - 정상 동작 중인 내부 테스트 필터 제거
  - 정상 동작 중인 CSV/XLSX 필터 전달 구조 변경
  - 기존 대화/리포트 원문 데이터 수정
  - 과거 `viewer_id` 데이터 임의 Backfill

## 2. 목표
현재 확인된 대표 문제:
```text
1. 사용자 수 / 이벤트 수 / (child,business_date) 슬롯 수를 하나의 퍼널처럼 혼용
2. 보정 완료 110 / 대상 107 = 102.8%
3. V3 미션 완료 실제 23건인데 behavior_events 기반 화면에서 0건
4. 리포트 생성 UI 110/110=100%지만 실제 생성 고유 슬롯은 109/114=95.6%
5. 부모 리포트 확인 UI 9/110=8.2%지만 실제 열람 고유 리포트는 40/109=36.7%
6. report_views에 viewer_id가 없어 한 가족의 열람을 모든 보호자에게 동일 복사
```

최종 목표:
```text
각 지표는
같은 단위의 분자 / 같은 단위의 분모
+
정확한 Source of Truth
+
명확한 설명
```

## 3. 요구사항

### 3-1. `행동 퍼널`과 `리포팅 파이프라인` 구조 분리
현재 하나의 흐름 안에서 `접속 → 미션 → 자유대화/놀이 → 수집 → 보정 → Memory → 리포트 → 부모 확인`을 이어 붙이고 있으나 단위가 다르므로 분리한다.

사용자 행동 퍼널:
```text
활성 사용자
→ 미션 시작 아이
→ 미션 완료 아이
→ 자유대화/놀이 활동 아이
```
동일 기간의 고유 사용자/아이 수 기준.

리포팅 파이프라인:
```text
하루 마감 수집
→ Context Correction
→ Memory Batch
→ Daily Report 생성
→ 리포트 열람
```
`(child_id,business_date)` 또는 실제 pipeline slot 단위.

### 3-2. V3 미션 시작/완료 Source of Truth 수정
V3 `daily_single`:
```text
미션 시도/시작 = mission_progress
미션 완료 = mission_progress.status='COMPLETED'
```
V3 관리자 KPI/퍼널/Drill-down에서 `behavior_events mission_complete`만 완료 Source로 사용하지 않는다.

### 3-3. V3 `mission_complete` 이벤트 로깅 보강
`app/api/mission/v3/turn/route.ts`의 실제 COMPLETED 전이 성공 지점에서 `behavior_events event_name='mission_complete'`를 1회 기록.
- 중복 생성 금지
- 이벤트 실패가 실제 미션 완료를 깨뜨리지 않게 처리
- 관리자 핵심 완료 집계 Source는 여전히 `mission_progress.status`

### 3-4. 상단 `미션 완료율` 정상화
V3는 같은 기간 `(child_id,business_date)` 기준으로:
```text
분모 = V3 미션 시도 대상
분자 = V3 COMPLETED 대상
```
중복 세션/재시작 dedupe.

### 3-5. 상세 Drill-down 미션 시도/완료 수정
V3는 `mission_progress` 기준. V2는 기존 로직 유지.

### 3-6. 리포트 생성률 계산식 정상화
추가 감사 최근 30일:
```text
daily report 실제 생성 고유 슬롯 = 109
실제 대상 슬롯 = 114
정상 생성률 = 95.6%
```
정상화:
```typescript
target = allTargets.size
completed = reportByKey.size
```
retry/reconcile로 동일 대상이 여러 job row여도 1회만 count.

### 3-7. 리포팅 품질 카드와 퍼널 Source 통일
동일 기간/필터에서 같은 `reportTargetKeys`, `reportGeneratedKeys` helper를 재사용해 퍼널/카드 값 불일치 제거.

### 3-8. `보정 완료 102.8%` 수정
서로 다른 집합을 분자/분모로 사용하지 않는다.
권장:
```text
allTargets
rawSuccessKeys
correctedSuccessKeys
memorySuccessKeys
reportSuccessKeys
```
단순 clamp로 100%를 숨기지 말고 계산식 자체를 고친다.

### 3-9. 일일 리포트 열람률 정상화
최근 30일 실측:
```text
생성된 고유 daily report = 109
열람된 고유 report = 40
정상 열람률 = 40/109 = 36.7%
```
정상화:
```typescript
target = reportByKey.size
completed = viewedReportKeys.size
```
`viewedReportKeys = DISTINCT report_views.report_id`.

### 3-10. 부모 참여율 별도 KPI 분리
리포트 열람률:
```text
열람된 고유 리포트 / 생성된 고유 리포트
```
부모 참여율:
```text
기간 내 1회 이상 리포트를 열람한 고유 부모 / 전체 대상 부모
```
둘을 같은 지표로 섞지 않는다.

### 3-11. `report_views.viewer_id` 추가
현재 schema:
```text
id
report_id
viewed_at
```
추가:
```sql
viewer_id UUID NULL REFERENCES auth.users(id)
```
현재 query 패턴을 보고 필요한 최소 index만 추가.

### 3-12. 일일 리포트 viewed API에서 viewer 저장
`app/api/parent/reports/[id]/viewed/route.ts`에서 client payload가 아니라 서버 인증 `user.id`를 `viewer_id`로 저장.
기존 access check 유지.

### 3-13. 다중 보호자 부모별 열람 집계 수정
가족 total을 각 parent에게 복사하는 fallback 제거.
```text
부모 A = report_views.viewer_id = A
부모 B = report_views.viewer_id = B
```

### 3-14. 과거 `viewer_id IS NULL` 정책
기존 기록을 특정 부모에게 임의 귀속하지 않는다.
```text
viewer_id IS NULL
→ 가족 단위 과거 열람에는 사용 가능
→ 부모별 개인 열람에는 미귀속
```
UI 필요 시 `부모별 열람 추적은 YYYY-MM-DD부터 제공` 안내.

### 3-15. 기존 노란 안내문 처리
신규 계측 적용 후 상시 경고 제거.
과거 기간 포함 시:
```text
부모별 열람 추적은 YYYY-MM-DD부터 제공됩니다.
그 이전 열람은 가족 단위 기록만 존재합니다.
```

### 3-16. 주간 리포트 열람 Source 정상화
현재:
```text
일일 = report_views + behavior_events
주간 = behavior_events feature='weekly_report'
```
부모별 분석에서는 일일/주간 모두 실제 부모 계정별로 구분되도록 최소 변경.
기존 `report_views.report_id`가 daily 전용 FK라면 무리하게 깨지 말고 공통 analytics helper에서 정규화하는 안전한 구조 허용.

### 3-17. behavior_events 리포트 열람 로깅 유지
Journey/행동 분석용으로 유지 가능하나 정확한 리포트 열람률/부모별 열람 Source로 단독 사용 금지.

### 3-18. 17:55 `collection_1` 레거시 제거 정합
094 적용 여부 확인.
적용됐다면 통합 분석의 `레거시 중간 수집`, `collection_1` 카드/단계 제거.
과거 pipeline_jobs 이력 삭제 금지.

### 3-19. 아이별 분석 보강
`부모 미열람`의 의미를 `가족 전체 미열람`과 `특정 부모 개인 미열람`로 혼동하지 않게 라벨/계산식 명확화.

### 3-20. 기간 / 대상 / 내부 테스트 필터 회귀 보존
기존 정상 필터 모두 유지:
```text
오늘/7/14/30/이번달/지난달/직접기간
전체/가족/부모/아이
내부 테스트 제외
Asia/Seoul
```

### 3-21. 내부 테스트 공식 기준 유지
`lib/admin/retentionFilter.ts`, `getTestFamilyIds()` 및 공식 `is_internal_test` 재사용.

### 3-22. CSV/XLSX Export 회귀 보존
수정 후 화면의 정상 계산식과 viewer_id 기반 부모별 데이터가 export에도 동일 반영되어야 한다.

## 4. 기존 구조 확인

### 4-1. 주요 경로
```text
app/api/admin/analytics/reporting/route.ts
lib/admin/retentionPeopleAnalytics.ts
app/api/admin/analytics/export/route.ts
app/api/parent/reports/[id]/viewed/route.ts
app/api/mission/v3/turn/route.ts
```

### 4-2. 일일 리포트 열람 흐름
```text
부모 /parent/report/[id]
→ POST /api/parent/reports/[id]/viewed
→ report_views INSERT
→ behavior_events parent_report_view
```

### 4-3. V3 미션
```text
conversation_goals = 진행도
mission_progress.status = 완료 여부
gold_key_ledger = 보상
```

### 4-4. 최근 30일 감사 확정값
```text
daily report 대상 슬롯 = 114
실제 생성 고유 daily report = 109
리포트 생성률 = 95.6%

report_views row = 71
열람된 고유 report = 40
리포트 열람률 = 36.7%

전체 대상 부모 = 44
behavior_events로 식별 가능한 열람 부모 = 2
부모 참여율 참고값 = 4.5%
```
과거 viewer_id 부재 때문에 부모별 과거 값은 신규 viewer 계측과 동일시하지 않는다.

## 5. 금지사항
- 사용자 수와 pipeline slot 수를 동일 퍼널로 연결 금지
- 100%를 clamp로 숨기기 금지
- behavior_events 누락 때문에 실제 V3 완료를 0 처리 금지
- 과거 report_views row를 특정 부모에게 임의 귀속 금지
- owner_parent에게 과거 열람 전부 Backfill 금지
- 가족 열람 건수를 모든 parent에게 복사 금지
- `daily_reports.viewed_at`를 열람 Source로 재사용 금지
- 정상 리텐션 계산 불필요 수정 금지
- 094 정책과 충돌하는 collection_1 재도입 금지
- 과거 pipeline/job 이력 삭제 금지
- 내부 테스트 필터 제거 금지
- Production Secret/API Key/Token 출력 금지
- 전체 UUID 기본 UI 노출 금지
- 대화 원문 분석 화면 노출 금지

## 6. 모호성 처리

### 6-1. 주간 report_views 확장
현재 `report_views.report_id` FK가 daily 전용인지 확인.
공통화가 위험하면 일일은 `report_views.viewer_id`, 주간은 `behavior_events.actor_id`를 공통 analytics helper에서 정규화.

### 6-2. 부모별 과거 열람
확정 불가하면 UNKNOWN 유지. 추정 금지.

### 6-3. 퍼널 대상 정의
`allTargets`의 실제 구성 기준을 코드/타입/주석으로 명확히 남기고 각 단계가 같은 key domain인지 확인.

## 7. QA

### 7-1. V3 미션 완료
실제 `daily_single COMPLETED` 최소 3명 → 미션 완료 KPI/Drill-down 포함.

### 7-2. 미완료 V3
IN_PROGRESS → 시도에는 포함, 완료에는 미포함.

### 7-3. 리포트 생성률
최근 30일 동일 필터 재검증. 감사 스냅샷 109/114=95.6%. 데이터 변동 시 현재 Source와 UI가 일치해야 함.

### 7-4. 리포트 열람률
같은 리포트를 여러 번 열어도 고유 report 1건.

### 7-5. 다중 보호자
부모 A만 신규 리포트 열람 → A +1, B +0.

### 7-6. 두 부모 모두 열람
동일 report를 A/B 각각 열람 → 리포트 열람률은 report 1건, 부모별 열람은 A1/B1.

### 7-7. 과거 viewer_id NULL
가족 과거 열람에는 포함 가능, 부모 개인 열람에는 미귀속.

### 7-8. 주간 리포트
신규 주간 열람이 실제 부모 계정으로 식별되는지 확인.

### 7-9. 100% 초과 방지
모든 비율 0~100%, 단 계산식 자체로 만족.

### 7-10. 기간 필터
오늘/7/14/30/월/직접기간 동일 Source 적용.

### 7-11. 내부 테스트
기본 제외 시 테스트 가족/부모/아이 미포함.

### 7-12. Export
CSV/XLSX와 화면 수치 일치.

### 7-13. Regression
```text
DAU
코호트 D1/D3/D7/D14/W2
아이별 분류
부모별 검색/정렬
상세 Drill-down
```
회귀 없음.

## 8. 완료 조건
- 행동 퍼널과 pipeline 분석 단위 분리
- V3 미션 완료 = mission_progress COMPLETED
- V3 mission_complete behavior event 신규 완료부터 정상 기록
- 미션 완료 0 오표시 제거
- 보정 성공률 100% 초과 제거
- 리포트 생성률 동일 Source 통일
- 리포트 생성 대상/성공 고유 key dedupe
- 일일 리포트 열람률 = unique viewed reports / unique generated reports
- 부모 참여율 별도 KPI/지표 분리
- report_views.viewer_id 추가
- viewed API에서 서버 인증 user.id 저장
- 다중 보호자 부모별 열람 분리
- 과거 viewer_id NULL 임의 Backfill 없음
- 주간 부모별 열람 추적 정상화
- `viewer_id 없음 → 가족 단위 표시` 상시 fallback 제거
- 094 적용 시 collection_1 레거시 분석 제거
- 기간/scope/internalTest 정상
- CSV/XLSX 정상
- TypeScript 오류 0
- Build 성공
- Dev QA PASS
- Production 배포 완료
- Production Smoke PASS

## 9. 완료 보고
1. 기존 대시보드 계산식 문제 요약
2. 행동 퍼널/리포팅 파이프라인 분리 결과
3. V3 미션 시작/완료 Source 변경
4. mission_complete 이벤트 보강
5. 보정 100% 초과 원인 및 수정
6. 리포트 생성률 변경 전/후
7. 리포트 열람률 변경 전/후
8. 부모 참여율 신규/분리 결과
9. report_views migration 내용
10. viewer_id 저장 API 변경
11. 다중 보호자 실제 검증
12. 과거 viewer_id NULL 처리 정책
13. 주간 리포트 부모별 열람 추적 방식
14. collection_1 레거시 처리
15. 기간/대상/internalTest 회귀
16. CSV/XLSX 검증
17. Production UI vs DB 실측 대조
18. TypeScript/Build
19. Dev QA
20. Production Deployment/Smoke
