# 087 v2 — 관리자 Product Analytics / Retention 통합 대시보드 전면 재설계

> 원본 지시서: `requests/087-admin-product-analytics-retention-dashboard-redesign.md` (v2, 2026-08-10 대표님 확정)
> Phase 0(AS-IS 진단)은 완료됨: `daily_reports.viewed_at` 미사용 컬럼 확정, IA 이동 범위(6~8개 파일) 확정,
> 스키마 방식(behavior_events 확장 + 별도 app_sessions 병행)은 지시서 §10에서 대표님이 그대로 채택.

## 실행 원칙

- **대표님이 v2 지시서를 최종 확정했다. Phase 1~5를 중간 재승인 없이 연속 진행하고,
  Production 배포·smoke까지 끝난 뒤에만 대표님 QA 대기로 전환한다.** Phase 2/3/4 착수 전
  별도 안내를 기다리지 않는다.
- 지시서 §0 최우선 원칙 그대로: 데이터 부족을 이유로 중단하지 않는다. 계산 가능한 지표는 즉시,
  불가능한 지표는 계측 구조만 먼저 깔고 "계측 중" 표시.
- 신규 계측 배포 이전 과거 데이터의 추정/backfill 금지(지시서 §12).
- `auth.users.last_sign_in_at` 방문 판단 용도 완전 제거(지시서 §11).
- `daily_reports.viewed_at`는 deprecated 표시만 하고 삭제하지 않음, 신규 분석 코드에서 미사용(지시서 §31).
- 보안(§49): 대화 원문/heartbeat 입력값/page content 저장 금지, Secret 노출 금지, UUID 기본 노출 금지,
  실사용자·내부테스트 데이터 혼합 금지(`is_internal_test`/`getTestFamilyIds()` 재사용).

## Phase 1 — 신규 Analytics 계측 인프라 (스키마 + 클라이언트 이벤트)

**개발 주체**: Codex Sol(architecture-sensitive: 신규 DB 스키마 + 세션 라이프사이클 계측)

- forward-only migration: `app_sessions` 테이블 신설(지시서 §10 권장 필드: session_id, actor_type,
  actor_id, family_id, child_id nullable, started_at, last_heartbeat_at, ended_at nullable,
  foreground_duration_sec, route_at_start, environment). anon/authenticated GRANT ALL(AGENTS.md 규약).
- `app_session_start`/`app_foreground`/`app_background`/`page_view`는 기존
  `lib/analytics/logBehaviorEvent.ts`를 재사용해 `behavior_events`에 기록(신규 테이블 불필요, 지시서 §10).
- `app_heartbeat`는 30초 주기로 `app_sessions.last_heartbeat_at`·`foreground_duration_sec`을 갱신하는
  신규 경량 API(`POST /api/analytics/session`)로 처리. heartbeat 페이로드에 route path 외 입력값·본문
  내용을 절대 포함하지 않는다.
- 클라이언트 훅: 부모/아이 공통 레이아웃에 세션 라이프사이클 훅 추가 — `visibilitychange`로
  foreground/background 판정, mount 시 `app_session_start`, unmount/beforeunload에 best-effort
  `app_session_end`(선택).
- 완료 조건: `app_session_start`가 DISTINCT actor 기준으로 KST 날짜별 방문 판정에 쓰일 수 있는 형태로
  적재되는지 Dev에서 직접 눈으로 확인(관리자 화면 없이 SQL로).

## Phase 2 — 신규 Analytics API/RPC (백엔드 집계)

**개발 주체**: Codex Sol(다수 endpoint, KST 타임존 공통 helper, N+1 방지, admin 인증 경계)

- 기존 재사용 우선 확인: `/api/admin/analytics`, `/api/admin/retention`, `/api/admin/usage-overview`,
  `lib/admin/analytics.ts`, `lib/admin/retentionChildMetrics.ts` 중 정확한 로직은 재사용, `last_sign_in_at`
  기반 방문 계산이 있으면 제거.
- 신규 RPC/API: `analytics/visits`, `analytics/sessions`, `analytics/stickiness`, `analytics/lifecycle`,
  `analytics/product-value`, `analytics/reports`(필요한 것만 추가, 지시서 §40).
- 활동 리텐션(§27)은 즉시 구현 가능 — mission/freechat/quiz/play(아이), report_view/parent_k/
  parent_question(부모) 기준 D1/D3/D7/D14/W2/W4.
- 방문 리텐션(§26)은 구조만 구현하고 Phase 1 계측 데이터가 쌓이기 전까지 "데이터 축적 중" 표시.
- 리포트 Source of Truth(§30~33): 일일 열람 = `report_views`만, 주간 열람 =
  `behavior_events(feature=weekly_report)`만, `daily_reports.viewed_at` 조회 0건.
- 공통 KST helper 하나로 모든 기간 필터(오늘/7일/14일/30일/이번달/지난달/직접기간) 통일.
- 내부 테스트 기본 제외: `is_internal_test`/`getTestFamilyIds()` 재사용(신규 판별 로직 금지).

## Phase 3 — 관리자 IA 개편 + 통합 대시보드 UI

**개발 주체**: Codex Terra(완성된 API를 소비하는 렌더링 중심 작업, 단 섹션이 많아 2회 분할 가능)

- IA: `운영 도구 > 회원가입 유입 현황`을 `리포팅·분석 > 통합 분석 대시보드 > 유입·가입`으로 이동(지시서 §4).
- 공통 필터바(기간/대상/유입채널/내부테스트) 1개 컴포넌트로 모든 섹션 공유(§6).
- Executive KPI 5~6개(§14), 이후 지시서 §15~§36 순서대로 섹션 구현. 계측 전 지표는 "계측 중"/
  "데이터 축적 중" 명시, 0으로 강제 변환 금지(§13, §41).
- Drill-down(§36): 가족/부모/아이 행 클릭 → Drawer.

## Phase 4 — Export

CSV/XLSX, 지시서 §43 sheet 구성 그대로. 신규 계측 전 빈 값은 0으로 강제 변환 금지.

## Phase 5 — Dev 검증 → agy E2E → Production 배포

- tsc 0 / build 성공 / Dev E2E PASS 확인 후 §4-D 표준 게이트 통과.
- Production 배포 후 smoke, 대표님 실기기 QA 요청(하드룰 7 + 색상 규칙 — 대표님 PASS 전 비녹색 유지).
- 완료 보고는 지시서 §48의 27개 항목 형식을 그대로 따른다.

## 진행 상태

- [x] Phase 1 완료 — 커밋 `05ee131`, Dev migration 적용·검증 완료, claude-review 진행 중 (2026-08-10)
- [ ] Phase 2 — 구현 완료, 실행환경 검증 대기: tsc/tests 통과. build 무메시지 종료·Dev 실호출 포트/네트워크 차단(2026-08-10)
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
