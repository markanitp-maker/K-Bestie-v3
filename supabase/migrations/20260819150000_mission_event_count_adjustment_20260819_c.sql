-- 2026-08-19 장애 보상 보정 (3차): `케이와 친해지는 30일` 이벤트 effective count 를
-- 윤도원(2nddodo) 6 -> 20, 윤도건(1stDoDo) 8 -> 20 으로 맞춘다. 대표 지시.
-- 유형: system_issue_compensation.
--
-- 구조·멱등성·안전장치는 20260819130000_mission_event_count_adjustments.sql 주석 참고.
-- 건드리지 않는 것: mission_progress, 자유대화 원장, gold_key_ledger,
-- child_mission_event_completions(counted 원장).
--   effective count = raw counted + adjustment 합계 = mission_completed_count
-- 보정 후에도 카운터는 증분 구조를 유지하므로 다음 유효 참여 1건에 21/60 이 된다.

WITH target AS (
  SELECT * FROM (VALUES
    ('fa514f91-8a35-4f59-ab31-d32399c49dc0'::uuid, 6, 14, 'mission-event-count-adj-2026-08-19-2nddodo'),
    ('e74a4ed1-7498-4183-9e51-5a026ecdf3ac'::uuid, 8, 12, 'mission-event-count-adj-2026-08-19-1stDoDo')
  ) AS v(child_id, expected_before, delta, adjustment_key)
),
ins AS (
  INSERT INTO public.child_mission_event_count_adjustments
    (event_id, child_id, delta, count_before, count_after, reason, adjustment_key, created_by, adjustment_type)
  SELECT e.id, e.child_id, t.delta, e.mission_completed_count,
         e.mission_completed_count + t.delta,
         '2026-08-19 대표 지시 장애 보상 — 시스템 이슈로 누락된 참여분을 되돌려 30일 이벤트 effective count 를 20회로 정정. 실제 완료 원장은 수정하지 않았다.',
         t.adjustment_key, 'ops:system-issue-compensation-2026-08-19', 'system_issue_compensation'
  FROM target t
  JOIN public.child_mission_onboarding_events e
    ON e.child_id = t.child_id
   AND e.environment = 'production'
   AND e.mission_completed_count = t.expected_before
  ON CONFLICT (adjustment_key) DO NOTHING
  RETURNING event_id, count_after
)
UPDATE public.child_mission_onboarding_events e
   SET mission_completed_count = LEAST(ins.count_after, 60),
       current_reward_amount = public.mission_onboarding_reward_tier(LEAST(ins.count_after, 60)),
       status = CASE WHEN LEAST(ins.count_after, 60) >= 60 THEN 'max_completed' ELSE e.status END,
       updated_at = now()
  FROM ins
 WHERE e.id = ins.event_id;
