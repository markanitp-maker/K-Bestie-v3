-- 2026-08-05 Production 리포팅 파이프라인 장애 대응 (2/2):
--
-- 대화가 0건인 정상적인 날짜(raw_daily_conversations_v3는 collection_2로 생성됐지만
-- raw_daily_conversation_messages_v3가 0건인 경우 — 그날 아이가 미션·자유대화를
-- 전혀 하지 않은, 진짜 실패가 아닌 정상 상태)가 lib/batch/contextCorrectionV3.ts의
-- processSingleCorrectionJob에서 "EMPTY_INPUT" 예외로 던져지고, 이 예외는
-- isRetryable=false로 분류되어 mark_pipeline_job_failed_v3(p_retryable: false)로
-- **영구 실패(PERMANENT_ERROR)** 처리되고 있었다. 실측 확인(안려원, 2026-08-04):
-- 그날 chat_messages가 실제로 0건인데도 context_correction job이 "실패"로 남아
-- 관리자 화면에 "대화수집 O · 리포트 X"로 영구히 보이는 원인이 됐다.
--
-- app/api/admin/reporting/run/route.ts의 generate 액션(220~231행)은 이미
-- corrected_daily_conversations_v3가 없을 때 memory_batch/daily_report를
-- NO_CONVERSATION으로 완료 처리하는 패턴을 쓰고 있다 — context_correction 단계에도
-- 동일한 패턴을 적용해, "대화 0건"을 실패가 아니라 정상 종료(리포트 불필요)로
-- 취급한다. 대화가 없는 날은 corrected/memory/report 모두 생성하지 않는 것이
-- 기존 비즈니스 로직과 일치한다(§app/api/admin/reporting/run/route.ts 참조).
CREATE OR REPLACE FUNCTION public.complete_context_correction_job_v3_no_conversation(
  p_job_id uuid,
  p_claimed_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  -- corrected_daily_conversations_v3 행은 만들지 않는다(대화 자체가 없으므로) —
  -- "Corrected 없음"이 이미 이 코드베이스 전체에서 NO_CONVERSATION의 판정 기준으로
  -- 쓰이고 있다(app/api/admin/reporting/run/route.ts generate 액션과 동일 계약).
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      last_error_code = NULL,
      last_error_summary = 'NO_CONVERSATION',
      updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.pipeline_execution_items
  SET status = 'completed',
      outcome = 'NO_CONVERSATION',
      completed_at = now(),
      updated_at = now()
  WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

  -- memory_batch/daily_report는 enqueue하지 않는다(할 일이 없음). 다만 관리자
  -- "수집 후 리포트 즉시 생성"처럼 이 두 단계를 미리 스냅샷해둔 실행이 있다면
  -- (pipeline_execution_items에 job_id 없이 pending으로만 존재) 그 추적 항목도
  -- 같이 닫아줘야 폴링 UI가 무한 대기하지 않는다.
  UPDATE public.pipeline_execution_items
  SET status = 'completed',
      outcome = 'NO_CONVERSATION',
      completed_at = now(),
      updated_at = now()
  WHERE child_id = v_job.child_id
    AND business_date = v_job.business_date
    AND job_type IN ('memory_batch', 'daily_report')
    AND status NOT IN ('completed', 'failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3_no_conversation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_context_correction_job_v3_no_conversation(uuid, text) TO service_role;
