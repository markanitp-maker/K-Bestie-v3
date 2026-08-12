# 073 Mission v3 Production Cutover 계획

> 2026-08-12 대표님 채팅 긴급지시. 최신 정책: Production 하루 1회 daily_single, 운영시간 09:00~23:50 KST. Dev는 scheduleEnforced=false로 24시간 오픈. 과거 round1_day/round2_night 데이터는 절대 수정/삭제 금지.

## 확인된 현재 상태 (2026-08-12 직접 조사)

- `MISSION_V3_EFFECTIVE_AT` 미설정 시 `lib/mission-v3/policyResolution.ts`가 안전하게 `v2_dual`로 폴백 — 코드 존재하나 Production에서 활성화 안 됨.
- `app/child/home/page.tsx:131` → `/api/mission/today-progress` (레거시 v2) 호출 중, v3 미전환.
- `app/child/missions/page.tsx:2030` → `/api/mission/start` (레거시 v2) 호출 중, v3 미전환.
- `vercel.json` crons:
  - `/api/batch/v3/collection/enqueue?phase=1` `55 8 * * *` (17:55 KST)
  - `/api/batch/v3/collection/enqueue?phase=2` `55 14 * * *` (23:55 KST)
  - `/api/batch/v3/reconcile` `10 15 * * *` (00:10 KST 익일)
  - `/api/cron/mission-start?missionType=1` `0 1 * * *` / `0 4 * * *` (10:00/13:00 KST) — 구버전 1차 알림 트리거로 추정, 조사 필요
  - `/api/cron/mission-start?missionType=2` `0 9 * * *` (18:00 KST) — 구버전 2차 알림 트리거로 추정, 조사 필요

## 안전 원칙 (절대 준수)

1. 과거 `round1_day`/`round2_night` 데이터 조회·리포트 로직은 historical-only로 남기고 수정/삭제하지 않는다.
2. 오늘(2026-08-12) 이미 v2 round를 생성한 아이가 존재 — cutover 경계는 기본값 `2026-08-13T00:00:00+09:00`. 당일 즉시 활성화는 compatibility guard(기존 v2 round 보유 child의 신규 daily_single 생성 차단) 구현·검증 전까지 금지.
3. Phase B(프론트 배선)는 `app/child/missions/page.tsx`를 건드리므로, 현재 진행 중인 P0(mic-autostart) 수정이 main에 병합되기 전까지 착수하지 않는다(공유 파일 충돌 방지, CLAUDE.md §1-A).

## Phase A — 백엔드/Cron (P0와 병렬 가능, page.tsx 미접촉)

- A1. v3 time gate를 09:00 inclusive ~ 23:50 exclusive 단일 window로 통일(기존 `lib/mission-v3/timePolicy.ts` 검토 후 조정)
- A2. child_id + business_date 기준 신규 Mission 최대 1개 보장 로직 확인/보강(DB 제약 또는 애플리케이션 가드)
- A3. Cron 통합: phase=1(17:55)/phase=2(23:55) 수집을 미션 마감(23:50) 이후 ~ Daily Report(04:00) 이전 1회 idempotent 수집으로 교체. raw/corrected/report 파이프라인과 late write/retry 검증.
- A4. 구버전 `/api/cron/mission-start` (missionType=1/2) 조사 — daily_single 전환 시 존치/통합/제거 여부 결정 후 처리.
- A5. `MISSION_V3_EFFECTIVE_AT` cutover 로직에 same-day mixed-policy guard 추가(오늘 이미 v2 round 있는 child는 신규 daily_single 미생성).
- A6. MissionOnboardingCard/store/push/admin/analytics의 구정책(1차/2차, 10:00~17:50, 18:00~24:00 하드코딩) 의존성 전수 조사 → 제거 또는 historical-only 처리.

## Phase B — 프론트 배선 (P0 병합 후 착수)

- B1. `app/child/home/page.tsx` → `/api/mission/v3/today-progress` 전환, 구정책 하드코딩(1차/2차, 하교후/취침전, 시간범위) 제거, "오늘의 미션 · 09:00~23:50" 기준 표시로 변경.
- B2. `app/child/missions/page.tsx` → v3 start/turn/today-progress 계약 배선.
- B3. 관련 컴포넌트(MissionOnboardingCard 등) v3 정책 반영.

## Phase C — Dev Gate 검증 매트릭스 (전부 PASS 필수)

- 09:00 start 가능 / 08:59 차단 / 23:49 가능 / 23:50 신규 시작 차단
- 하루 두 번째 신규 Mission 차단
- home/missions 화면이 v3 API만 호출(레거시 호출 0건)
- old 1차/2차 안내 문구 0건
- Cron 1회만 동작
- historical round1/round2 조회 정상(과거 데이터 훼손 없음)
- report가 round2 부재를 incomplete로 오판하지 않음
- reward/event 60 compatibility 정상
- TypeScript/unit/integration/build/E2E 전부 PASS

## Phase D — Production Cutover

- Dev Gate 전부 PASS 확인 후에만 Production `MISSION_V3_EFFECTIVE_AT=2026-08-13T00:00:00+09:00` 설정.
- 배포 후 실사용 모니터링(첫 daily_single 생성, Cron 1회 실행, 리포트 정상 생성) 확인.

## Phase A 구현 보고 (2026-08-12)

- A1: `MISSION_SCHEDULE_ENFORCED=true`인 Production은 KST 09:00 inclusive ~ 23:50
  exclusive 단일 window로 통일했다. false인 Dev는 24시간 허용한다. 방학 여부에 따른
  10:00/13:00 분기는 v3에서 제거했고, v2 historical gate에만 남겼다.
- A2: 기존 migration의 `mission_progress_daily_single_child_date_key` 부분 unique index가
  `(child_id, business_date) WHERE round_type='daily_single'`을 보장하고, start route가
  `23505` 경합 시 생성 세션을 롤백한 뒤 기존 세션으로 resume함을 확인했다. 추가 DDL은
  불필요하며 과거 round row는 수정하지 않았다.
- A3: Vercel collection Cron을 23:55 KST 단일 `/api/batch/v3/collection/enqueue`로
  교체했다. DB 내부 `collection_2` 명칭은 historical raw/report 스키마 호환용 마감 슬롯으로
  유지한다. 00:00~03:50 KST 통합 worker를 10분 간격으로 등록했다. 최신 RPC는 자정 cutoff,
  advisory lock/idempotency key, completed job reset, failed job 재대기, reconcile downstream 복구를
  제공한다. 단, 자동 reconcile은 기존 completed `collection_2` job이 있는 child를 후보에서
  제외하므로 자정 수집과 경합해 늦게 commit된 전일 timestamp 메시지의 자동 재수집 연결은
  확인되지 않았다. 이 late-write race는 `[미검증]`으로 남기며 DB 함수는 변경하지 않았다.
- A4 조사: `/api/cron/mission-start`는 미션을 생성하지 않고 child push 구독자에게 v2 라운드
  시작 알림을 보낸다. 방학 10:00/학기 13:00의 missionType=1, 18:00의 missionType=2를
  검증하고, 해당 round 완료·당일 cron 발송 성공·알림 비활성 child를 제외한 뒤 발송 로그를
  남긴다. daily_single에서 유지하면 같은 날 중복/오정책 알림이므로 Production 활성화 전
  별도 승인 작업에서 세 legacy schedule을 제거하고 09:00 단일 daily 알림 계약으로 교체할
  것을 권고한다. 이번 Phase A에서는 지시대로 route와 세 legacy Cron을 변경하지 않았다.
- A5: effective-at 이후에도 해당 child/business_date에 `v2_dual` progress가 하나라도 있으면
  child-aware policy resolver가 그날은 `v2_dual`을 유지한다. 조회 실패도 fail-closed로 처리해
  v3 생성을 허용하지 않는다.
- A6: onboarding card는 `/60` event activity로 policy-neutral임을 명시했다. demo store의
  하교 후/잠들기 전 문구를 제거했고, push/v2 route/time gate/old correction을 historical-only로
  표시했다. 관리자 reporting은 `daily_single`을 하루 마감 슬롯으로 집계하며 retention KPI는
  daily_single을 하루 1개 logical slot으로 센다. collection analytics/UI의 1차/2차 운영 문구는
  `레거시 중간 수집`/`하루 마감 수집`으로 바꿨다.

과거 `round1_day`/`round2_night` row, migration, raw snapshot 및 historical 조회 로직에는
UPDATE/DELETE나 의미 변경을 가하지 않았다.

## 진행 상태

- [ ] Phase A (검증종료 — A1/A2/A4/A5/A6·tsc·test·build 통과, A3 late-write race 미검증, commit은 Git metadata read-only로 실패)
- [ ] Phase B (P0 병합 대기)
- [ ] Phase C
- [ ] Phase D
