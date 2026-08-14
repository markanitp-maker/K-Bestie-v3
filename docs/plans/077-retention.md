# 077 관리자 아이별·부모별 Retention 분석 계획

## 범위와 원칙

- 기존 `/admin/analytics`의 전체 개요·KPI·퍼널·코호트·품질 화면은 유지한다.
- `computeChildActivityMetrics()`와 KST/내부 테스트 필터를 재사용하고 새 리텐션 정의를 만들지 않는다.
- `daily_reports.viewed_at`은 사용하지 않고 `report_views`만 열람 Source of Truth로 사용한다.
- `report_views`에는 viewer 식별자가 없으므로 부모 행의 열람 지표는 가족 단위임을 UI/API에 명시한다.
- P0만 구현한다. `app_sessions`, 황금열쇠, MBTI, 출석 룰렛은 P1로 남긴다.
- DB migration, backfill, Production DB·배포는 하지 않는다.

## 변경 대상

- `lib/admin/retentionPeopleAnalytics.ts`
- `lib/admin/retentionPeopleAnalytics.test.ts`
- `app/api/admin/analytics/children/route.ts`
- `app/api/admin/analytics/parents/route.ts`
- `app/api/admin/analytics/export/route.ts`
- `components/admin/RetentionPeopleTabs.tsx`
- `app/admin/analytics/page.tsx`
- `e2e/qa-077-admin-retention.spec.ts`

## 데이터 흐름

1. `requireAdmin` 통과 후 기존 KST 기간·내부 테스트 필터를 해석한다.
2. 자녀/부모/가족 identity와 활동·리포트·열람·부모 질문을 배치 조회한다.
3. 자녀 활동은 기존 `computeChildActivityMetrics()`로 7일·30일·전체를 계산한다.
4. `daily_reports.child_id`와 `report_views.report_id`를 Map으로 조인한다.
5. 부모 질문은 `parent_id`가 있으면 부모별, 아이/가족 지표는 `child_id` 기준으로 집계한다.
6. 설명 가능한 상태 규칙을 공통 함수로 적용한 뒤 검색·필터·정렬·페이지네이션한다.
7. 화면과 export가 동일 query 계약을 사용한다.

## 10분 단위 작업

1. 공통 타입·상태·정렬·페이지네이션 순수 함수와 테스트.
2. 아이별 API 배치 집계와 관리자 인증 계약.
3. 부모별 API 배치 집계와 가족 단위 열람 한계 표기.
4. 기존 분석 화면 탭·아이 테이블·필터·상세 링크.
5. 부모 테이블·연결 아이 요약·상세 drawer.
6. tab별 CSV/XLSX export 연결.
7. 타입체크·단위 테스트·build·Dev E2E 및 회귀 확인.

## 완료 조건

- 전체 개요는 기존 응답과 화면을 유지한다.
- 아이별/부모별 탭에서 검색, 내부 테스트, 기간, 상태, 정렬, 페이지 크기와 이동이 동작한다.
- D1/D3/D7/W2 미도래는 `-`이며 실패로 분류되지 않는다.
- 아이는 기존 `/admin/retention/children/[childId]`로 이동한다.
- export는 현재 탭과 동일 필터를 사용하고 대화 원문을 포함하지 않는다.
- DB 변경 0, Production 변경 0.

## 위험 요소

- 부모별 `report_views`는 viewer_id 부재로 가족 단위만 정확하다. 개인별로 추정하지 않는다.
- 기존 통합 API가 이미 다수의 배치 조회를 수행하므로 아이/부모 탭은 필요할 때만 별도 API를 호출한다.
- 관리자 실로그인 E2E는 고정 QA 계정/세션이 준비된 Dev에서만 수행한다.
