-- finalize_mission_onboarding_event의 ON CONFLICT 대상을 event_reward_fulfillments의
-- 새 제약(event_type, event_reference_id, child_id)에 맞춰 갱신한다
-- (20260804040000_reward_fulfillments_composite_unique.sql 참고).

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
    return v_event;
  end if;

  if now() < v_event.ends_at then
    return v_event;
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
    on conflict (event_type, event_reference_id, child_id) do nothing;
  end if;

  return v_event;
end;
$$;

commit;
