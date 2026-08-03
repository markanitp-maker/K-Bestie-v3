-- 퀴즈 리더보드 수신 미러 + 통합 상품권 지급 + 로그인 공지 확인
-- (requests/request_kbestie_app_events.md, .omc/specs/deep-interview-kbestie-app-events.md §10)
--
-- kbestie_quiz_final_snapshots/entries는 퀴즈마스터가 소유한
-- quiz_leaderboard_final_snapshots/entries(같은 공유 Supabase DB, 별도 레포 마이그레이션
-- 20260804000001)와 이름이 겹치지 않도록 K-Bestie 쪽 수신 미러 테이블에 kbestie_ 접두어를
-- 붙였다(§10 Addendum). K-Bestie는 이 테이블만 쓰고, 퀴즈마스터 소유 테이블은 절대
-- 건드리지 않는다.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 퀴즈 리더보드 최종 스냅샷 수신 미러 (quiz.leaderboard.finalized.v1 웹훅 수신 기록)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.kbestie_quiz_final_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  environment               text not null
                              check (environment in ('development', 'production')),
  period_key                text not null,

  event_id                  text not null, -- 웹훅 payload의 eventId — Idempotency-Key와 동일 값
  period_started_at         timestamptz not null,
  period_ended_at_exclusive timestamptz not null,
  finalized_at              timestamptz not null,

  scoring_version           text not null,
  checksum                  text not null,

  received_at               timestamptz not null default now(),
  created_at                timestamptz not null default now(),

  constraint kbestie_quiz_final_snapshots_env_event_unique unique (environment, event_id),
  constraint kbestie_quiz_final_snapshots_env_period_unique unique (environment, period_key)
);

comment on table public.kbestie_quiz_final_snapshots is
  '퀴즈마스터 quiz.leaderboard.finalized.v1 웹훅 수신 기록(K-Bestie 소유 미러). eventId 유일성으로 재전송 시 중복 저장을 막는다. 퀴즈마스터가 소유한 quiz_leaderboard_final_snapshots(별도 레포 마이그레이션)와는 다른 테이블이다. RLS on, 정책 없음: service_role 전용.';

alter table public.kbestie_quiz_final_snapshots enable row level security;
grant select, insert, update, delete
  on public.kbestie_quiz_final_snapshots to service_role;

create table if not exists public.kbestie_quiz_final_entries (
  id               uuid primary key default gen_random_uuid(),
  snapshot_id      uuid not null
                     references public.kbestie_quiz_final_snapshots(id) on delete cascade,
  rank             integer not null check (rank in (1, 2, 3)),
  child_id         uuid not null,

  score            integer not null check (score >= 0),
  correct_count    integer,
  completed_quiz_count integer,
  is_seed_user     boolean not null default false,
  reward_eligible  boolean not null default true,
  reward_amount    integer not null check (reward_amount >= 0),
  tie_break_values jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),

  constraint kbestie_quiz_final_entries_snapshot_rank_unique unique (snapshot_id, rank),
  constraint kbestie_quiz_final_entries_snapshot_child_unique unique (snapshot_id, child_id)
);

comment on table public.kbestie_quiz_final_entries is
  '퀴즈 최종 스냅샷의 1·2·3위 항목(K-Bestie 소유 미러). is_seed_user=true 더미는 rank에 표시되지만 reward_eligible=false로 지급 대상에서 제외된다. RLS on, 정책 없음: service_role 전용.';

alter table public.kbestie_quiz_final_entries enable row level security;
grant select, insert, update, delete
  on public.kbestie_quiz_final_entries to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 통합 상품권 지급 (미션 이벤트 + 퀴즈 이벤트 공용, 완전 수동 처리)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.event_reward_fulfillments (
  id                     uuid primary key default gen_random_uuid(),
  environment            text not null
                           check (environment in ('development', 'production')),
  event_type             text not null
                           check (event_type in ('mission_onboarding', 'quiz_leaderboard')),
  event_reference_id     uuid not null, -- child_mission_onboarding_events.id 또는 kbestie_quiz_final_entries.id

  child_id               uuid not null,
  parent_user_id         uuid,

  reward_amount          integer not null check (reward_amount >= 0),
  reward_type            text not null default 'gift_card',

  -- 완전 수동 워크플로우 — 자동 발송 연동 없음(대표 지시). 실제 전달은 대표님이
  -- 보호자에게 오프라인으로 직접 하며, 관리자 화면은 상태 기록만 담당한다.
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'scheduled', 'delivered', 'on_hold', 'cancelled')),
  delivery_method        text not null default 'offline' check (delivery_method = 'offline'),

  approved_by            uuid,
  approved_at            timestamptz,
  delivered_at           timestamptz,
  delivered_by           uuid,
  admin_note             text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint event_reward_fulfillments_ref_unique unique (event_type, event_reference_id)
);

comment on table public.event_reward_fulfillments is
  '미션 30일 이벤트 + 퀴즈 리더보드 이벤트 공용 상품권 지급 기록. delivery_method는 항상 offline로 고정 — 자동 발송 연동을 구현하지 않는다(대표 지시). status는 관리자가 수동으로 승인→전달완료까지 처리한다. RLS on, 정책 없음: service_role 전용.';

create index if not exists event_reward_fulfillments_status_idx
  on public.event_reward_fulfillments (environment, status);
create index if not exists event_reward_fulfillments_child_idx
  on public.event_reward_fulfillments (environment, child_id);

alter table public.event_reward_fulfillments enable row level security;
grant select, insert, update, delete
  on public.event_reward_fulfillments to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 로그인 이벤트 안내 팝업 — 버전별 서버 acknowledgement (localStorage 사용 금지)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.event_announcement_acknowledgements (
  id                    uuid primary key default gen_random_uuid(),
  announcement_key      text not null,
  announcement_version  integer not null,
  audience_type         text not null check (audience_type in ('child', 'parent')),

  parent_user_id        uuid,
  child_id              uuid,

  acknowledged_at       timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  constraint event_announcement_ack_audience_target_check check (
    (audience_type = 'parent' and parent_user_id is not null and child_id is null)
    or
    (audience_type = 'child' and child_id is not null and parent_user_id is null)
  )
);

comment on table public.event_announcement_acknowledgements is
  '로그인 이벤트 안내 팝업의 버전별 확인 상태. localStorage가 아니라 이 테이블이 재노출 여부의 기준이다. audience_type별로 parent_user_id 또는 child_id 중 하나만 채운다. RLS on, 정책 없음: service_role 전용.';

create unique index if not exists event_announcement_ack_parent_unique
  on public.event_announcement_acknowledgements (announcement_key, announcement_version, parent_user_id)
  where audience_type = 'parent';

create unique index if not exists event_announcement_ack_child_unique
  on public.event_announcement_acknowledgements (announcement_key, announcement_version, child_id)
  where audience_type = 'child';

alter table public.event_announcement_acknowledgements enable row level security;
grant select, insert, update, delete
  on public.event_announcement_acknowledgements to service_role;

commit;
