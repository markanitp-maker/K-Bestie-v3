-- 운영 보정 원장에 **보정 유형**을 남긴다.
-- 20260819130000 은 유형을 reason 산문에만 담았다. 유형별 집계·감사(예: 장애 보상만
-- 골라내기)가 필요하므로 별도 컬럼으로 분리한다. 기존 행은 대표 지시에 따른 수동
-- 보정이었으므로 default 'manual_compensation' 이 그대로 맞다.
--
--   manual_compensation      운영 판단으로 대표가 지시한 개별 보정
--   system_issue_compensation 장애·집계 누락으로 실제 참여가 카운트되지 않아 되돌려주는 보상

ALTER TABLE public.child_mission_event_count_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_type text NOT NULL DEFAULT 'manual_compensation';

ALTER TABLE public.child_mission_event_count_adjustments
  DROP CONSTRAINT IF EXISTS child_mission_event_count_adjustments_type_chk;

ALTER TABLE public.child_mission_event_count_adjustments
  ADD CONSTRAINT child_mission_event_count_adjustments_type_chk
  CHECK (adjustment_type IN ('manual_compensation', 'system_issue_compensation'));

COMMENT ON COLUMN public.child_mission_event_count_adjustments.adjustment_type IS
  '보정 유형. manual_compensation=운영 판단 개별 보정, system_issue_compensation=장애로 누락된 실제 참여 보상.';
