-- `케이와 친해지는 30일` 이벤트 완료 횟수의 **운영 보정 원장**.
--
-- [왜 필요한가]
-- 실제 완료 원장(public.child_mission_event_completions)은 아이가 실제로 미션/자유대화를
-- 끝낸 사실만 담는다. 장애·집계 누락 때문에 운영이 횟수를 손으로 맞춰야 할 때, 그 원장에
-- 허위 COMPLETED 행을 넣으면 "실제로 무슨 일이 있었는가"를 되짚을 수 없게 된다.
-- 그래서 보정은 실제 완료와 물리적으로 분리된 이 테이블에만 기록한다.
--
-- [표시·보상과의 관계]
-- 화면(아이 홈 / 부모 홈 / 관리자 이벤트)과 보상 구간은 모두
-- child_mission_onboarding_events.mission_completed_count 한 컬럼만 읽는다
-- (실측 2026-08-19: app/api/events/mission-onboarding/my-status/route.ts,
--  app/api/admin/events/mission-onboarding/route.ts, app/api/admin/retention/children/route.ts).
-- 그 컬럼은 실제 완료 시 +1 씩 누적되는 증분 카운터이고, 원장에서 재집계하는 함수는
-- 존재하지 않는다(실측: mission_completed_count 를 쓰는 함수는 record_mission_event_completion,
-- complete_freechat_daily_engagement, finalize_mission_onboarding_event 뿐이며 전부 증분/참조).
-- 따라서 보정 delta 를 그 카운터에 더하면 카운터 = 실제 누적 + 보정 합계가 되고,
-- 세 화면과 보상 계산이 자동으로 같은 값을 본다. 앱 코드 변경은 필요 없다.
-- 이 테이블은 "그 카운터의 어느 부분이 보정분인가"에 대한 감사 기록이다.
--   실제 완료분 = mission_completed_count - (이 테이블의 delta 합계)
--
-- [멱등성]
-- adjustment_key 가 UNIQUE 다. 같은 보정 작업을 다시 실행하면 INSERT 가 ON CONFLICT 로
-- 걸러지고, 카운터 UPDATE 는 실제로 INSERT 된 행만 대상으로 하므로 중복 가산되지 않는다.
--
-- [권한] 서버 service_role / 운영 스크립트 전용. RLS on, policy 없음.

CREATE TABLE IF NOT EXISTS public.child_mission_event_count_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES public.child_mission_onboarding_events(id) ON DELETE CASCADE,
  child_id       uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  delta          integer NOT NULL CHECK (delta <> 0),
  count_before   integer NOT NULL CHECK (count_before >= 0),
  count_after    integer NOT NULL CHECK (count_after >= 0),
  reason         text NOT NULL CHECK (length(btrim(reason)) > 0),
  adjustment_key text NOT NULL UNIQUE,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS child_mission_event_count_adjustments_child_idx
  ON public.child_mission_event_count_adjustments(child_id, created_at DESC);

ALTER TABLE public.child_mission_event_count_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.child_mission_event_count_adjustments FROM anon, authenticated;

COMMENT ON TABLE public.child_mission_event_count_adjustments IS
  '30일 이벤트 완료 횟수 운영 보정 원장. 실제 완료 원장(child_mission_event_completions)은 절대 수정하지 않고 보정분만 여기에 남긴다. adjustment_key UNIQUE 로 멱등.';
