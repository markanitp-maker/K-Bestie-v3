-- finalize_mission_onboarding_event가 종료 확정 시 최종 보상액이 0보다 크면
-- event_reward_fulfillments에 지급 대상을 원자적으로 함께 생성하도록 확장한다
-- (요청서 §10.2, unique(event_type, event_reference_id)로 재실행에도 중복 생성 없음).
-- 20260804020000(event_reward_fulfillments 테이블 생성) 이후에 적용해야 한다.

begin;

create or replace function public.finalize_mission_onboarding_event(p_event_id uuid)
returns public.child_mission_onboarding_events
language plpgsql
as $$
declare
  v_event public.child_mission_onboarding_events;
  v_final_count integer;
  v_final_reward integer;
begin
  select * into v_event
  from public.child_mission_onboarding_events
  where id = p_event_id
  for update;

  if v_event is null then
    return null;
  end if;

  if v_event.status = 'completed' then
    return v_event; -- 이미 종료 처리됨 — 멱등
  end if;

  if now() < v_event.ends_at then
    return v_event; -- 아직 종료 시각 전
  end if;

  v_final_count := least(v_event.mission_completed_count, 60);
  v_final_reward := public.mission_onboarding_reward_tier(v_final_count);

  update public.child_mission_onboarding_events
  set status = 'completed',
      completed_at = v_event.ends_at,
      final_mission_count = v_final_count,
      final_reward_amount = v_final_reward,
      updated_at = now()
  where id = p_event_id
  returning * into v_event;

  if v_final_reward > 0 then
    insert into public.event_reward_fulfillments
      (environment, event_type, event_reference_id, child_id, reward_amount)
    values
      (v_event.environment, 'mission_onboarding', v_event.id, v_event.child_id, v_final_reward)
    on conflict (event_type, event_reference_id) do nothing;
  end if;

  return v_event;
end;
$$;

comment on function public.finalize_mission_onboarding_event is
  '30일 종료 시각 도달 시 최종 완료횟수·보상금액을 확정하고 completed로 전환. 최종 보상액이 0보다 크면 event_reward_fulfillments에 지급 대상(pending)을 함께 생성한다(멱등). 멱등 — 이미 completed면 그대로 반환.';

commit;
