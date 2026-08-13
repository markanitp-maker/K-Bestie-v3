-- Mission v3 완료 기준 변경(목표 10개 생성 / 5개 달성)에 따른 goal_order 상한 확대.
-- 기존 제약은 goal_order <= 4로, 코드가 10개를 생성하면 INSERT가
-- conversation_goals_goal_order_check 위반으로 실패한다.
-- (2026-08-14 Dev 실측: POST /api/mission/v3/start 500 — "미션 대화를 준비하지 못했어요.")
--
-- 하한 1은 그대로 두고 상한만 4 → 10으로 넓힌다. 기존 행(goal_order 1~4)은
-- 새 제약을 그대로 만족하므로 데이터 변경이나 백필이 필요 없다.

ALTER TABLE public.conversation_goals
  DROP CONSTRAINT IF EXISTS conversation_goals_goal_order_check;

ALTER TABLE public.conversation_goals
  ADD CONSTRAINT conversation_goals_goal_order_check
  CHECK (goal_order >= 1 AND goal_order <= 10);
