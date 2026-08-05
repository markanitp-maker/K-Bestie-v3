-- requests/request-parent-query-router-grade4-v1.md
-- §3 기존 질문 제한 정책과의 통합: "아이별 주 3회 + 아이별 하루 최대 1건"을 원자적으로
-- 적용해야 하는데, parent_question_quota.daily_used_at 컬럼은 이미 존재하지만
-- try_deduct_parent_question_quota RPC가 이를 전혀 읽거나 갱신하지 않아 일일 제한이
-- 사실상 적용되지 않고 있었다(이전 "주2회+일1회" 정책에서 "주3회만"으로 바뀌며 남은
-- 컬럼으로 추정). 이번에 daily 체크를 RPC에 추가해 실제로 동작하게 한다.
--
-- §12 상태값 및 데이터 모델: 정책 판정 감사(auditing)를 위해 parent_questions에
-- router_* 컬럼을 추가한다. status 상태 모델 자체는 기존 값을 그대로 재사용한다
-- (GREEN_DRAFT는 기존 draft 단계와 동일하게 DB에 행을 만들지 않고, PENDING/ASKED는
-- 기존 'ai_generated', ANSWER_CAPTURED/CONFIRMING은 기존 'reconfirm_pending',
-- ANSWERED/DECLINED/EXPIRED/CANCELLED는 기존 'confirmed'/'declined'/'expired'/'cancelled'
-- 그대로 매핑되므로 status CHECK 제약은 변경하지 않는다).

ALTER TABLE public.parent_questions
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_grade smallint,
  ADD COLUMN IF NOT EXISTS router_route text,
  ADD COLUMN IF NOT EXISTS router_area text,
  ADD COLUMN IF NOT EXISTS router_rule_id text,
  ADD COLUMN IF NOT EXISTS router_policy_version text,
  ADD COLUMN IF NOT EXISTS router_confidence numeric,
  ADD COLUMN IF NOT EXISTS router_evidence jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parent_questions_router_route_check'
  ) THEN
    ALTER TABLE public.parent_questions
      ADD CONSTRAINT parent_questions_router_route_check
      CHECK (router_route IS NULL OR router_route IN ('CRISIS', 'RED', 'GREEN'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parent_questions_source ON public.parent_questions(source);
CREATE INDEX IF NOT EXISTS idx_parent_questions_router_route ON public.parent_questions(router_route);

-- 일일(KST 캘린더 날짜) + 주간(월요일 시작) 제한을 같은 행잠금 안에서 원자적으로 검사한다.
-- RETURNS TABLE 컬럼명이 parent_question_quota 컬럼명과 겹치면 앞선 마이그레이션에서
-- 이미 한 번 걸렸던 "column reference is ambiguous" 버그가 재발하므로, 테이블을 q로
-- alias하고 모든 참조를 q.<col>로 명시한다.
-- RETURNS TABLE 컬럼 목록 자체가 바뀌므로(daily_limit_reached 추가) CREATE OR REPLACE로는
-- 안 되고 먼저 DROP해야 한다.
DROP FUNCTION IF EXISTS public.try_deduct_parent_question_quota(uuid);

CREATE FUNCTION public.try_deduct_parent_question_quota(p_child_id uuid)
RETURNS TABLE(allowed boolean, weekly_used_count integer, weekly_reset_at timestamptz, daily_limit_reached boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_week_start timestamptz := (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_used integer;
  v_reset timestamptz;
  v_daily_used_at timestamptz;
BEGIN
  INSERT INTO public.parent_question_quota (child_id, weekly_used_count, weekly_reset_at)
  VALUES (p_child_id, 0, v_week_start)
  ON CONFLICT (child_id) DO NOTHING;

  SELECT q.weekly_used_count, q.weekly_reset_at, q.daily_used_at
  INTO v_used, v_reset, v_daily_used_at
  FROM public.parent_question_quota q
  WHERE q.child_id = p_child_id
  FOR UPDATE;

  IF v_reset < v_week_start THEN
    v_used := 0;
    v_reset := v_week_start;
    UPDATE public.parent_question_quota q
    SET weekly_used_count = 0, weekly_reset_at = v_week_start
    WHERE q.child_id = p_child_id;
  END IF;

  -- 하루 최대 1건: daily_used_at이 오늘(KST) 날짜면 차단. 자정이 지나면 자동으로
  -- 오늘 날짜와 달라지므로 별도 리셋 로직이 필요 없다.
  IF v_daily_used_at IS NOT NULL AND (v_daily_used_at AT TIME ZONE 'Asia/Seoul')::date = v_today_kst THEN
    RETURN QUERY SELECT false, v_used, v_reset, true;
    RETURN;
  END IF;

  IF v_used >= 3 THEN
    RETURN QUERY SELECT false, v_used, v_reset, false;
    RETURN;
  END IF;

  UPDATE public.parent_question_quota q
  SET weekly_used_count = q.weekly_used_count + 1, daily_used_at = now()
  WHERE q.child_id = p_child_id
  RETURNING q.weekly_used_count, q.weekly_reset_at INTO v_used, v_reset;

  RETURN QUERY SELECT true, v_used, v_reset, false;
END;
$function$;

-- 환불 시 주간 카운트뿐 아니라 오늘 사용한 일일 슬롯도 되돌려준다(§3 "취소·Red·Crisis·
-- API 실패는 횟수 미차감" — 이미 차감된 뒤 되돌리는 경로이므로 daily_used_at도 함께 비운다).
CREATE OR REPLACE FUNCTION public.refund_parent_question_quota(p_child_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public.parent_question_quota
  SET weekly_used_count = GREATEST(0, weekly_used_count - 1),
      daily_used_at = NULL
  WHERE child_id = p_child_id;
$function$;
