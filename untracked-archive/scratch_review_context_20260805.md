# Production 리포팅 파이프라인 장애 — 정적 리뷰 요청

## 배경
Production 관리자 화면에서 실사용자 대화수집은 O로 바뀌지만 리포트는 X로 남아
관리자가 매일 수동으로 "수집 후 리포트 즉시 생성"을 눌러야 하는 장애가 반복됨.

## 읽기전용 진단으로 확정한 사실
1. pg_cron 호출: 최근 3일간 모든 v3-* job이 `succeeded` (HTTP 401/에러 없음, CRON_SECRET 인증 정상).
2. `enqueue_collection_jobs_v3`: business_date/cutover_at 조건과 무관하게 chat_messages.created_at
   기준으로 대상 선정 — 정상 동작, business_date NULL의 영향을 받지 않음(설계상 무관).
3. Collection Phase2 완료 시 `collect_chat_messages_v3`가 트랜잭션 내에서
   `enqueue_context_correction_job_v3`를 직접 호출(forward-chaining) — 정상 배포·동작 확인.
4. `claim_context_correction_jobs_v3` / `claim_memory_batch_jobs_v3` / `claim_daily_report_jobs_v3`
   3개 RPC 모두 `status='processing' AND claim_expires_at<=now()`인 stale lease를 재claim
   가능하게 이미 처리하고 있고, execution_id에 종속되지 않는 범용 큐 방식.
5. **근본원인**: 위 3개 claim을 소비하는 pg_cron(`v3-context-correction-worker`=jobid 25,
   `v3-memory-worker`=jobid 26, `v3-daily-report-worker`=jobid 27)이 **하루 딱 1회만**
   (각각 15:05 / 15:20 / 15:35 UTC = 00:05/00:20/00:35 KST) 실행됨. 각 워커 라우트
   (app/api/batch/v3/{context-correction,memory,daily-report}/worker/route.ts)는 내부적으로
   claim=0 될 때까지 최대 20회 반복하므로 "그 순간 존재하는" pending job은 모두 처리하지만,
   그 좁은 실행 시각 이후에 생성되거나(관리자 수동 실행, 뒤늦은 collection 재시도 등) 다시
   claimable(processing lease 만료)해진 job은 **다음날 같은 시각까지(최대 24시간) 아무도
   집지 않는다.**
6. 실측 증거: 2026-08-04 안려원(child 69dc74f5) context_correction job이 05:15 KST(그날
   워커 실행 시각 00:05 KST 이후)에 생성돼 pending 상태로 방치, 2026-08-03에도 context_correction
   2건이 동일 패턴으로 pending 상태였음(수동 admin_pulse로만 나중에 처리됨).
7. `chat_sessions.business_date` 방어 트리거(20260804070000, `trg_chat_sessions_fill_business_date`)는
   이미 Production에 배포되어 정상 동작 중 — 8/3 이후 신규 NULL 0건 확인(2026-08-05 진단 시점
   기준 잔여 NULL 25건은 전부 2026-07-29~08-02 생성분, 트리거 적용 이전 레거시).
8. V3 파이프라인(raw_daily_conversations_v3 등)은 `pipeline_jobs.business_date`(원본
   chat_messages.created_at 기반 산출)를 키로 쓰므로 `chat_sessions.business_date` NULL과
   무관 — 다만 부모 화면 등 다른 기능이 이 컬럼을 직접 참조할 수 있어 레거시 25건도 안전하게
   (NULL인 값만 채움, 기존 값 미변경) 백필 예정.

## 제안하는 수정 (2개 SQL, Production 직접 적용 예정)

### 1) scratch_fix_20260805.sql — pg_cron 재스케줄
jobid 25/26/27을 `55 8 * * *` 형태(1일 1회)에서 `*/10 * * * *`(10분 간격 상시)로 변경.
- 각 워커는 pending 없으면 claim 쿼리 1회로 즉시 종료(LLM 비용 없음) — 상시 실행 비용 안전.
- `cron.alter_job()`으로 schedule만 변경, command/기존 인증(CRON_SECRET Bearer)은 그대로 유지.

### 2) scratch_backfill_business_date_20260805.sql — 레거시 business_date NULL 25건 백필
`business_date IS NULL`인 행만 `(started_at AT TIME ZONE 'Asia/Seoul')::date`로 채움.
기존 값이 있는 행은 WHERE 절 때문에 절대 건드리지 않음. 8/3 백필 때 썼던 것과 동일한
안전한 패턴(20260804070000 마이그레이션 §축1 참조), 이번엔 범위만 "전체 NULL"로 확장.

## 검토 요청 사항
- 위 근본원인 진단이 타당한지(다른 가능성을 놓치지 않았는지 — 특히 "Job 0건=Cron 미실행"으로
  성급히 단정하지 않았는지 관점에서 재검토)
- 두 SQL의 정합성/안전성(원자성, 실사용자 데이터 파괴 위험 없는지, WHERE절 누락 등)
- 10분 간격 상시 실행으로 바꾸는 것이 부작용(중복 실행 경합 등)을 일으키지 않는지
  — claim RPC가 `FOR UPDATE SKIP LOCKED`를 쓰므로 동시 실행 자체는 안전한지 확인 요청
- [QA 인계] 시나리오도 함께 제시

읽기전용 검토만 하고 파일을 수정하지 마라.
