-- 2026-08-05 Production 리포팅 파이프라인 장애 수정
-- 근본원인: context-correction-worker(jobid 25)/memory-worker(jobid 26)/
-- daily-report-worker(jobid 27) pg_cron이 하루 1회만 실행되어, 그 좁은 실행
-- 시각(15:05/15:20/15:35 UTC) 이후 생성되거나(관리자 수동 재시도, 늦은 재수집 등)
-- 재claim 가능 상태(processing lease 만료)가 된 Job은 다음날 같은 시각까지
-- (최대 24시간) 자동으로 집히지 않는다. claim RPC들(claim_context_correction_jobs_v3,
-- claim_memory_batch_jobs_v3, claim_daily_report_jobs_v3)은 이미 stale lease
-- reclaim과 execution_id 무관 큐잉을 정상 지원하므로, 유일한 결함은 호출 빈도다.
--
-- 수정: 3개 워커 pg_cron을 하루 1회 → 10분 간격 상시 실행으로 변경한다. 각 워커는
-- 이미 라우트 내부에서 claim=0이 될 때까지 최대 20회 반복 후 종료하므로(코드 확인
-- 완료), pending Job이 없으면 사실상 무해한 SELECT 1회로 끝난다(LLM 호출 등 비용
-- 발생 없음).

-- 사전 확인: jobid 25/26/27이 실제로 기대한 워커가 맞는지 확인 없이 alter하지 않는다.
DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN SELECT jobid, jobname FROM cron.job WHERE jobid IN (25, 26, 27) ORDER BY jobid LOOP
    IF (v_row.jobid = 25 AND v_row.jobname != 'v3-context-correction-worker')
      OR (v_row.jobid = 26 AND v_row.jobname != 'v3-memory-worker')
      OR (v_row.jobid = 27 AND v_row.jobname != 'v3-daily-report-worker') THEN
      RAISE EXCEPTION 'UNEXPECTED_JOBNAME: jobid % is %, expected different worker', v_row.jobid, v_row.jobname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM cron.job WHERE jobid IN (25, 26, 27)) != 3 THEN
    RAISE EXCEPTION 'MISSING_JOBID: expected exactly 3 rows for jobid 25/26/27';
  END IF;
END $$;

SELECT cron.alter_job(
  job_id := 25,
  schedule := '*/10 * * * *'
);

SELECT cron.alter_job(
  job_id := 26,
  schedule := '*/10 * * * *'
);

SELECT cron.alter_job(
  job_id := 27,
  schedule := '*/10 * * * *'
);

-- 검증
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobid IN (25, 26, 27) ORDER BY jobid;
