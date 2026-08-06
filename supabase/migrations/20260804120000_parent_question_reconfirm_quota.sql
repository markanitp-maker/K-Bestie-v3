-- requests/request-parent-question-feature.md
-- 기존 parent_questions/parent_question_quota 테이블을 재사용하되(§10 "기존 스키마를
-- 먼저 확인하고 재사용"), 다음 3가지 확정 정책 변경/누락 보강을 반영한다.
-- 1) 주간 한도: 기존 "주 2회+일 1회"(애플리케이션 레벨, 비원자적) → "주 3회만"(§2.1),
--    반드시 DB에서 원자적으로 처리(§11).
-- 2) 아이 답변 재확인(§6) — 재확인 질문 문구를 저장할 컬럼과, 재확인 대기/취소/만료를
--    구분할 상태값이 없었다(기존 CHECK 제약이 이 값들을 막고 있었음).
-- 3) 부모가 등록 전 취소하는 것과 아이가 답변을 거부하는 것이 둘 다 'declined'로
--    합쳐져 있어 부모 화면에 잘못된 문구가 노출될 수 있었다 — 'cancelled'로 분리.

ALTER TABLE public.parent_questions
  ADD COLUMN IF NOT EXISTS confirmation_question_text text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

ALTER TABLE public.parent_questions DROP CONSTRAINT IF EXISTS parent_questions_status_check;
ALTER TABLE public.parent_questions ADD CONSTRAINT parent_questions_status_check
  CHECK (status = ANY (ARRAY[
    '대기중', '전달됨', '중지됨', -- 레거시 호환(과거 행에 남아있을 수 있음, 신규 생성 안 함)
    'draft', 'ai_generated', 'parent_edited',
    'mission_confirming', 'reconfirm_pending',
    'confirmed', 'declined', 'cancelled', 'expired',
    'mission_incomplete', 'failed_system', 'failed_recovered'
  ]));

COMMENT ON COLUMN public.parent_questions.confirmation_question_text IS '§6 재확인 질문 문구("~가 맞아?"). reconfirm_pending 상태일 때 다음 미션 턴에서 이 문구를 그대로 물어본다.';
COMMENT ON COLUMN public.parent_questions.child_answer_summary IS '아이가 최종 확인(재확인 포함)한 답변 요약 — confirmed 상태로 전이될 때만 채워진다. 1차 원문 STT가 아니라 재확인까지 끝난 값만 저장(§6.2).';

-- 기존 deadline_at 기본값(48시간) → 요청서 §4 "등록 후 7일 이내" 반영.
ALTER TABLE public.parent_questions
  ALTER COLUMN deadline_at SET DEFAULT (now() + interval '7 days');

-- §11 주간 3회 원자적 차감 — 동시 요청에서도 3회를 초과하지 않도록 행 잠금(FOR UPDATE)으로 직렬화.
-- 기존 daily_used_at 컬럼은 삭제하지 않되(과거 데이터 보존) 이 함수는 더 이상 일일 제한을
-- 걸지 않는다(§2.1 신규 정책에 일 제한이 없음 — 애플리케이션 lib/plan/parentQuestionQuota.ts의
-- 기존 로직도 이 RPC로 교체한다).
CREATE OR REPLACE FUNCTION public.try_deduct_parent_question_quota(p_child_id uuid)
RETURNS TABLE(allowed boolean, weekly_used_count integer, weekly_reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_week_start timestamptz := (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');
  v_used integer;
  v_reset timestamptz;
BEGIN
  INSERT INTO public.parent_question_quota (child_id, weekly_used_count, weekly_reset_at)
  VALUES (p_child_id, 0, v_week_start)
  ON CONFLICT (child_id) DO NOTHING;

  SELECT weekly_used_count, weekly_reset_at INTO v_used, v_reset
  FROM public.parent_question_quota
  WHERE child_id = p_child_id
  FOR UPDATE;

  IF v_reset < v_week_start THEN
    v_used := 0;
    v_reset := v_week_start;
    UPDATE public.parent_question_quota
    SET weekly_used_count = 0, weekly_reset_at = v_week_start
    WHERE child_id = p_child_id;
  END IF;

  IF v_used >= 3 THEN
    RETURN QUERY SELECT false, v_used, v_reset;
    RETURN;
  END IF;

  UPDATE public.parent_question_quota
  SET weekly_used_count = weekly_used_count + 1
  WHERE child_id = p_child_id
  RETURNING weekly_used_count, weekly_reset_at INTO v_used, v_reset;

  RETURN QUERY SELECT true, v_used, v_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.try_deduct_parent_question_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_deduct_parent_question_quota(uuid) TO service_role;

-- 등록 실패 시(§2.1 "시스템 오류로 등록되지 않은 경우 차감하지 않는다") 또는 부모 취소 시
-- 원자적으로 환불한다.
CREATE OR REPLACE FUNCTION public.refund_parent_question_quota(p_child_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.parent_question_quota
  SET weekly_used_count = GREATEST(0, weekly_used_count - 1)
  WHERE child_id = p_child_id;
$$;

REVOKE ALL ON FUNCTION public.refund_parent_question_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_parent_question_quota(uuid) TO service_role;

GRANT ALL ON public.parent_questions TO anon, authenticated;
GRANT ALL ON public.parent_question_quota TO anon, authenticated;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.try_deduct_parent_question_quota(uuid);
-- DROP FUNCTION IF EXISTS public.refund_parent_question_quota(uuid);
-- ALTER TABLE public.parent_questions DROP CONSTRAINT IF EXISTS parent_questions_status_check;
-- ALTER TABLE public.parent_questions ADD CONSTRAINT parent_questions_status_check
--   CHECK (status = ANY (ARRAY['대기중','전달됨','중지됨','draft','ai_generated','parent_edited','mission_confirming','confirmed','declined','mission_incomplete','failed_system','failed_recovered']));
-- ALTER TABLE public.parent_questions DROP COLUMN IF EXISTS confirmation_question_text, DROP COLUMN IF EXISTS confirmed_at, DROP COLUMN IF EXISTS declined_at, DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS expired_at;
