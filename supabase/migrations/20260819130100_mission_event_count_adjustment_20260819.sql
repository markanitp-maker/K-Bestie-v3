-- 2026-08-19 운영 보정: `케이와 친해지는 30일` 이벤트 유효 완료 횟수를
-- 안서아(asa160202) 31 -> 32, 안서현(ash160202) 27 -> 32 로 맞춘다. 대표 지시.
--
-- 건드리지 않는 것: mission_progress, gold_key_ledger, child_mission_event_completions.
-- 보정 근거와 구조는 20260819130000_mission_event_count_adjustments.sql 주석 참고.
--
-- 멱등: adjustment_key UNIQUE + "실제로 INSERT 된 행만" 카운터에 반영.
-- 재실행하면 ins CTE 가 0행이므로 UPDATE 대상도 0행이다.
--
-- 안전장치: 보정 전 카운트가 기대값(안서아 31, 안서현 27)과 다르면 그 아이는 건너뛴다
-- (v.expected_before = e.mission_completed_count 조건). 이미 다른 경로로 올라가 있었다면
-- 조용히 덮어쓰지 않고 아무 일도 일어나지 않게 한다.

WITH target AS (
  SELECT * FROM (VALUES
    ('b4faf92b-5707-4362-b9c0-9b85653a91cc'::uuid, 31, 1, 'mission-event-count-adj-2026-08-19-asa160202'),
    ('eabe9339-e6d5-472f-8199-5c9361da286a'::uuid, 27, 5, 'mission-event-count-adj-2026-08-19-ash160202')
  ) AS v(child_id, expected_before, delta, adjustment_key)
),
ins AS (
  INSERT INTO public.child_mission_event_count_adjustments
    (event_id, child_id, delta, count_before, count_after, reason, adjustment_key, created_by)
  SELECT e.id, e.child_id, t.delta, e.mission_completed_count,
         e.mission_completed_count + t.delta,
         '2026-08-19 대표 지시 운영 보정 — 30일 이벤트 유효 완료 횟수를 32회로 정정. 실제 완료 원장은 수정하지 않았다.',
         t.adjustment_key, 'ops:manual-compensation-2026-08-19'
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
