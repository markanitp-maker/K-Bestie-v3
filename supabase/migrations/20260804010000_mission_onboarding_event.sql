-- 미션 30일 온보딩 이벤트 (requests/request_kbestie_app_events.md, .omc/specs/deep-interview-kbestie-app-events.md)
--
-- 아이별 최초 유효 미션 완료 시점부터 정확히 30일간 미션 완료 횟수를 집계하고,
-- 최고 달성 구간(10/30/50/60회)에 따라 상품권 1개만 지급한다. 생애 1회, 환경별 독립.
--
-- 기존 공식 미션 완료 판정(behavior_events.event_name='mission_complete',
-- app/api/mission/answer/route.ts:1044-1055)을 그대로 신뢰하며, 새로 판정 로직을
-- 만들지 않는다. 서버 RPC 하나로 "이벤트 인스턴스 생성(최초 1회)" + "완료 원장
-- 멱등 기록" + "카운트 증가(60 상한)"를 원자적으로 처리해 동시요청·재시도에도
-- 안전하게 한다.

begin;

create table if not exists public.child_mission_onboarding_events (
  id                     uuid primary key default gen_random_uuid(),
  child_id               uuid not null,
  environment            text not null
                            check (environment in ('development', 'production')),

  status                 text not null default 'active'
                            check (status in ('active', 'max_completed', 'completed')),

  started_at             timestamptz not null,
  ends_at                timestamptz not null,
  completed_at           timestamptz,

  mission_completed_count integer not null default 0
                            check (mission_completed_count >= 0 and mission_completed_count <= 60),
  final_mission_count     integer
                            check (final_mission_count is null or (final_mission_count >= 0 and final_mission_count <= 60)),
  current_reward_amount   integer not null default 0 check (current_reward_amount >= 0),
  final_reward_amount     integer check (final_reward_amount is null or final_reward_amount >= 0),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint child_mission_onboarding_events_env_child_unique unique (environment, child_id)
);

comment on table public.child_mission_onboarding_events is
  '아이별 30일 미션 온보딩 이벤트. 환경+child_id 유일 — 아이당 환경별 생애 1회. started_at/ends_at은 일반 UI에서 수정 금지, record_mission_event_completion/finalize_mission_onboarding_event RPC를 통해서만 갱신한다. RLS on, 정책 없음: service_role 전용.';

create index if not exists child_mission_onboarding_events_status_idx
  on public.child_mission_onboarding_events (environment, status, ends_at);

alter table public.child_mission_onboarding_events enable row level security;
grant select, insert, update, delete
  on public.child_mission_onboarding_events to service_role;

-- 완료 원장 — mission_session_id 유일성으로 중복 집계를 구조적으로 차단한다.
create table if not exists public.child_mission_event_completions (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null
                       references public.child_mission_onboarding_events(id) on delete cascade,
  child_id           uuid not null,
  mission_session_id uuid not null,
  mission_completed_at timestamptz not null,

  -- 이벤트 기간 밖(마감 이후)이거나 60회 상한 도달 이후 완료는 counted=false로
  -- 감사용으로만 남긴다. 삭제하지 않는다 — "왜 이 미션은 집계에서 빠졌나"를
  -- 데이터로 답할 수 있어야 한다.
  counted            boolean not null default true,
  excluded_reason    text,

  created_at         timestamptz not null default now(),

  constraint child_mission_event_completions_session_unique unique (event_id, mission_session_id),
  constraint child_mission_event_completions_excluded_reason_check
    check (counted or excluded_reason is not null)
);

comment on table public.child_mission_event_completions is
  '30일 미션 이벤트 완료 원장. (event_id, mission_session_id) 유일성이 네트워크 재시도·동시요청에도 이중 집계를 차단한다. RLS on, 정책 없음: service_role 전용.';

create index if not exists child_mission_event_completions_event_idx
  on public.child_mission_event_completions (event_id, mission_completed_at);

alter table public.child_mission_event_completions enable row level security;
grant select, insert, update, delete
  on public.child_mission_event_completions to service_role;

-- 보상 구간 계산 — 클라이언트/관리자에서 각자 재계산하지 않도록 단일 함수로 관리(요청서 §10.3).
create or replace function public.mission_onboarding_reward_tier(p_count integer)
returns integer
language sql
immutable
as $$
  select case
    when p_count >= 60 then 10000
    when p_count >= 50 then 5000
    when p_count >= 30 then 3000
    when p_count >= 10 then 1000
    else 0
  end;
$$;

-- 미션 완료 1건을 원자적으로 반영한다: 이벤트 인스턴스가 없으면 이번 완료 시각을
-- started_at으로 생성하고, 완료 원장에 멱등 기록한 뒤(중복이면 즉시 반환),
-- 이벤트 기간 내이고 60 미만이면 카운트를 1 증가시킨다. 60 도달 시 status를
-- max_completed로 전환한다(§10.1).
create or replace function public.record_mission_event_completion(
  p_child_id uuid,
  p_environment text,
  p_mission_session_id uuid,
  p_mission_completed_at timestamptz
)
returns public.child_mission_onboarding_events
language plpgsql
as $$
declare
  v_event public.child_mission_onboarding_events;
  v_inserted boolean;
  v_in_window boolean;
begin
  if p_environment not in ('development', 'production') then
    raise exception 'invalid environment: %', p_environment;
  end if;

  -- 이벤트 인스턴스: 없으면 이번 완료 시각을 최초 완료 시각으로 생성(멱등 — 동시요청 시
  -- 하나만 승리하고 나머지는 기존 행을 그대로 읽는다).
  insert into public.child_mission_onboarding_events (child_id, environment, started_at, ends_at)
  values (p_child_id, p_environment, p_mission_completed_at, p_mission_completed_at + interval '30 days')
  on conflict (environment, child_id) do nothing;

  select * into v_event
  from public.child_mission_onboarding_events
  where environment = p_environment and child_id = p_child_id
  for update;

  v_in_window := p_mission_completed_at >= v_event.started_at
                 and p_mission_completed_at < v_event.ends_at;

  -- 완료 원장 멱등 기록. 이미 존재하면(재시도/중복 콜백) 아무것도 하지 않고 현재 상태를 반환.
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

comment on function public.record_mission_event_completion(uuid, text, uuid, timestamptz) is
  '미션 공식 완료 1건을 30일 온보딩 이벤트에 원자적으로 반영. 이벤트 최초 생성 + 완료 원장 멱등 삽입 + 기간내 카운트 증가(60 상한)를 한 트랜잭션에서 처리한다.';

-- 종료 처리 — 지연평가(다음 조회 시점)와 정기 cron 양쪽에서 안전하게 호출 가능한 멱등 함수.
create or replace function public.finalize_mission_onboarding_event(p_event_id uuid)
returns public.child_mission_onboarding_events
language plpgsql
as $$
declare
  v_event public.child_mission_onboarding_events;
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

  update public.child_mission_onboarding_events
  set status = 'completed',
      completed_at = v_event.ends_at,
      final_mission_count = least(mission_completed_count, 60),
      final_reward_amount = public.mission_onboarding_reward_tier(least(mission_completed_count, 60)),
      updated_at = now()
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;

comment on function public.finalize_mission_onboarding_event is
  '30일 종료 시각 도달 시 최종 완료횟수·보상금액을 확정하고 completed로 전환. 멱등 — 이미 completed면 그대로 반환.';

commit;
