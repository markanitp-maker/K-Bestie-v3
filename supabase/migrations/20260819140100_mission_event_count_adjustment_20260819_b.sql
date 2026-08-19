-- 2026-08-19 장애 보상 보정 (2차): `케이와 친해지는 30일` 이벤트 유효 카운트를
-- 안예원(jkinim1) 19 -> 24, 고나연(Gny9048) 13 -> 24 로 맞춘다. 대표 지시.
-- 유형: system_issue_compensation (장애로 누락된 실제 참여를 되돌려주는 1회성 보상).
--
-- 건드리지 않는 것: mission_progress, 자유대화 원장, gold_key_ledger,
-- child_mission_event_completions(counted 원장). 실제 완료 원장은 그대로 두고
-- 보정분만 child_mission_event_count_adjustments 에 남긴다.
--   effective count = raw counted + adjustment 합계 = mission_completed_count
--
-- 멱등: adjustment_key UNIQUE + 실제로 INSERT 된 행만 카운터에 반영.
-- 안전장치: 보정 전 카운트가 기대값(안예원 19, 고나연 13)과 다르면 그 아이는 건너뛴다.
--
-- 보정 후에도 카운터는 증분 구조를 그대로 유지한다 — record_mission_event_completion /
-- complete_freechat_daily_engagement 는 mission_completed_count + 1 로 올리므로
-- 다음 유효 참여 1건에 24 -> 25 로 정상 증가한다.

WITH target AS (
  SELECT * FROM (VALUES
    ('a88a37e5-6fe7-4dcc-ae0f-768a6e8bff75'::uuid, 19,  5, 'mission-event-count-adj-2026-08-19-jkinim1'),
    ('22599eb6-b7b0-47db-9bad-7785c11e40b9'::uuid, 13, 11, 'mission-event-count-adj-2026-08-19-Gny9048')
  ) AS v(child_id, expected_before, delta, adjustment_key)
),
ins AS (
  INSERT INTO public.child_mission_event_count_adjustments
    (event_id, child_id, delta, count_before, count_after, reason, adjustment_key, created_by, adjustment_type)
  SELECT e.id, e.child_id, t.delta, e.mission_completed_count,
         e.mission_completed_count + t.delta,
         '2026-08-19 대표 지시 장애 보상 — 시스템 이슈로 누락된 참여분을 되돌려 30일 이벤트 유효 카운트를 24회로 정정. 실제 완료 원장은 수정하지 않았다.',
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
