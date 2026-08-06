-- 형진님 2026-08-04 지시: 30일 미션 이벤트는 2026-08-04 00:00 KST 출시 기준시각부터
-- 새로 집계한다. 그 이전에 이미 완료된 미션(예: 안서아·안서현의 과거 완료 11건)이
-- 소급 집계되어 11/60으로 표시되는 것은 잘못이다. 원본 mission_progress/미션 완료
-- 기록은 절대 손대지 않고, 이벤트 전용 원장(child_mission_onboarding_events /
-- child_mission_event_completions)만 기준시각 이전 데이터를 걸러내도록 RPC를 고친다.
CREATE OR REPLACE FUNCTION public.record_mission_event_completion(
  p_child_id uuid,
  p_environment text,
  p_mission_session_id uuid,
  p_mission_completed_at timestamp with time zone
)
RETURNS child_mission_onboarding_events
LANGUAGE plpgsql
AS $$
declare
  v_event public.child_mission_onboarding_events;
  v_inserted boolean;
  v_in_window boolean;
  v_launch_cutoff_at constant timestamptz := '2026-08-04 00:00:00+09';
begin
  if p_environment not in ('development', 'production') then
    raise exception 'invalid environment: %', p_environment;
  end if;

  -- 출시 기준시각 이전 완료는 이벤트 대상이 아니다 — 이벤트 자체를 생성하지도,
  -- 카운트를 올리지도 않는다. 이미 다른 사유로 이벤트가 존재하면(예: 사전 시딩)
  -- 그 현재 상태를 그대로 반환한다.
  if p_mission_completed_at < v_launch_cutoff_at then
    select * into v_event
    from public.child_mission_onboarding_events
    where environment = p_environment and child_id = p_child_id;
    return v_event; -- 없으면 NULL 반환(호출부는 이미 실패를 무시하도록 설계돼 있음)
  end if;

  insert into public.child_mission_onboarding_events (child_id, environment, started_at, ends_at)
  values (p_child_id, p_environment, p_mission_completed_at, p_mission_completed_at + interval '30 days')
  on conflict (environment, child_id) do nothing;

  select * into v_event
  from public.child_mission_onboarding_events
  where environment = p_environment and child_id = p_child_id
  for update;

  v_in_window := p_mission_completed_at >= v_event.started_at
                 and p_mission_completed_at < v_event.ends_at;

  insert into public.child_mission_event_completions
    (event_id, child_id, mission_session_id, mission_completed_at, counted, excluded_reason)
  values (
    v_event.id, p_child_id, p_mission_session_id, p_mission_completed_at,
    v_in_window and v_event.status = 'active',
    case
      when v_event.status <> 'active' then 'event_already_' || v_event.status
      when not v_in_window then 'outside_30day_window'
      else null
    end
  )
  on conflict (event_id, mission_session_id) do nothing
  returning true into v_inserted;

  if v_inserted and v_in_window and v_event.status = 'active' then
    update public.child_mission_onboarding_events
    set mission_completed_count = mission_completed_count + 1,
        current_reward_amount = public.mission_onboarding_reward_tier(mission_completed_count + 1),
        status = case when mission_completed_count + 1 >= 60 then 'max_completed' else status end,
        updated_at = now()
    where id = v_event.id
    returning * into v_event;
  end if;

  return v_event;
end;
$$;
