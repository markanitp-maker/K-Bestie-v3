-- 목적: QuizMaster 리더보드를 "아이(child_id)별 누적 점수·누적 풀이시간·완료 횟수"로
-- 확정하고, 실사용자 행이 실제로 적재되도록 고친다.
--
-- ── 근본 원인 (2026-07-26 Dev Supabase mkrsaaedxqrcrktapaus 실측) ──────────────
-- 1) lib/quiz/play/profile.ts의 getLeaderboardIdentity()가 `return null` 플레이스홀더로
--    남아 있었다(커밋 f191b5b "021: 퀴즈마스터를 K-Bestie 내부 ... 놀이 모듈로 전환").
--    → app/api/quiz-play/submit/route.ts가 p_name=NULL, p_login_id=NULL로 RPC를 호출.
--    → quiz_submit_attempt의 `if p_name is not null and p_login_id is not null` 가드가
--      항상 거짓 → 리더보드 upsert 자체가 한 번도 실행된 적이 없음.
--    → quiz_leaderboard에는 2026-07-24 시드된 is_seed_user=true 10행만 존재하고
--      실사용자 행은 0행. 100점 attempt(a359fc44…)도 반영 안 됨. 이게 신고된 증상이다.
-- 2) quiz_leaderboard의 고유키가 PRIMARY KEY (user_id) = 로그인 계정(보호자도 가능)이라
--    한 보호자 계정으로 여러 자녀를 플레이하면 서로 다른 아이의 점수가 한 행으로
--    합쳐진다(requireChildAccess는 보호자에게 여러 child_id 접근을 허용한다).
-- 3) 완료 횟수(completed_attempts) 컬럼 자체가 없었다.
-- 4) 누적 멱등성이 attempt의 status 전이에만 의존했다(attempt_id 원장 없음).
--
-- ── 이 마이그레이션이 하는 일 ────────────────────────────────────────────────
-- A. quiz_leaderboard의 고유 단위를 user_id → child_id로 전환(PK 교체).
--    기존 시드 10행은 실제 child_profiles가 없는 가상 경쟁자이므로 child_id에
--    자기 user_id(가상 UUID)를 그대로 채워 넣어 동일 테이블·동일 정렬 풀에 남긴다.
--    child_id에는 FK를 걸지 않는다(기존 user_id도 FK가 없었고, 시드 행이 깨진다).
-- B. completed_attempts 컬럼 추가(시드 행은 1회 완료로 간주).
-- C. quiz_leaderboard_attempts 원장 신설 — attempt_id PK로 "이 attempt는 이미
--    누적됐다"를 못 박아, 재제출·새로고침·콜백 재시도에서 재누적을 구조적으로 차단.
-- D. quiz_submit_attempt 재작성:
--    - 누적 대상 child_id는 클라이언트 입력이 아니라 quiz_attempts 행의 child_id를
--      RETURNING으로 읽어 쓴다(서버 authoritative). 함수 시그니처는 그대로.
--    - 누적 시간은 새로 계산하지 않는다. 기존 서버 authoritative 타이머가 확정한
--      accumulated_time_seconds(위 UPDATE의 백그라운드 예산 차감 로직 원본 그대로)를
--      그대로 더한다.
--    - 반환 테이블에 result_completed_attempts를 추가한다(OUT 컬럼이 바뀌므로
--      CREATE OR REPLACE가 불가 → DROP 후 재생성).
--
-- 기존 'submitted' 상태 attempt는 원장에 없지만, 이미 status='submitted'라서 재제출
-- 경로(already_submitted 분기)로 빠지므로 소급 누적되지 않는다. 과거 attempt 소급
-- 백필은 의도적으로 하지 않는다(별도 판단 사항).

begin;

-- ── A. child_id 고유키 전환 ─────────────────────────────────────────────────
alter table public.quiz_leaderboard
  add column if not exists child_id uuid;

-- 시드 경쟁자: 대응하는 실제 child_profiles가 없으므로 기존 가상 user_id를 그대로 승계.
update public.quiz_leaderboard
set child_id = user_id
where child_id is null;

alter table public.quiz_leaderboard
  alter column child_id set not null;

alter table public.quiz_leaderboard
  drop constraint if exists quiz_leaderboard_pkey;

alter table public.quiz_leaderboard
  add constraint quiz_leaderboard_pkey primary key (child_id);

-- user_id는 이제 고유키가 아니라 "마지막으로 이 아이를 플레이시킨 로그인 계정" 메타데이터.
create index if not exists quiz_leaderboard_user_id_idx
  on public.quiz_leaderboard (user_id);

-- 기본 정렬(누적점수 DESC → 누적시간 ASC → 먼저 달성 순)을 위한 커버링 인덱스.
create index if not exists quiz_leaderboard_rank_idx
  on public.quiz_leaderboard (cumulative_score desc, cumulative_time asc, updated_at asc);

-- ── B. 완료 횟수 ────────────────────────────────────────────────────────────
alter table public.quiz_leaderboard
  add column if not exists completed_attempts integer not null default 0;

alter table public.quiz_leaderboard
  drop constraint if exists quiz_leaderboard_completed_attempts_check;
alter table public.quiz_leaderboard
  add constraint quiz_leaderboard_completed_attempts_check
  check (completed_attempts >= 0);

-- 시드 10행은 "1회 완료로 이 누적치를 만든 경쟁자"로 취급한다.
update public.quiz_leaderboard
set completed_attempts = 1
where is_seed_user = true
  and completed_attempts = 0;

-- ── C. attempt_id 멱등성 원장 ────────────────────────────────────────────────
create table if not exists public.quiz_leaderboard_attempts (
  attempt_id   uuid primary key references public.quiz_attempts(id) on delete cascade,
  child_id     uuid not null,
  score        integer not null,
  time_seconds double precision not null,
  counted_at   timestamptz not null default now()
);

create index if not exists quiz_leaderboard_attempts_child_id_idx
  on public.quiz_leaderboard_attempts (child_id);

-- quiz_leaderboard와 동일한 접근 모델: RLS 켜고 정책 없음(서비스 롤만 우회 접근).
alter table public.quiz_leaderboard_attempts enable row level security;

grant select, insert, update, delete on public.quiz_leaderboard_attempts to service_role;

-- ── D. quiz_submit_attempt 재작성 ────────────────────────────────────────────
drop function if exists public.quiz_submit_attempt(uuid, text, integer, text, text);

create function public.quiz_submit_attempt(
  p_attempt_id    uuid,
  p_session_token text,
  p_score         integer,
  p_name          text,
  p_login_id      text
)
returns table(
  result_score              integer,
  result_accumulated_time   double precision,
  result_cumulative_score   integer,
  result_cumulative_time    double precision,
  result_completed_attempts integer,
  result_already_submitted  boolean,
  result_found              boolean
)
language plpgsql
as $function$
declare
  v_user_id       uuid;
  v_child_id      uuid;
  v_score         int;
  v_accumulated   double precision;
  v_cum_score     int;
  v_cum_time      double precision;
  v_cum_attempts  int;
  v_first_submit  boolean;
  v_newly_counted boolean;
begin
  -- Guarded finalize: only fires while the attempt is still active AND no
  -- refund has already been requested for it. 타이머 계산식은 원본 그대로 —
  -- 서버 authoritative elapsed를 여기서 확정하고, 리더보드는 그 값만 재사용한다.
  update quiz_attempts
  set
    accumulated_time_seconds = accumulated_time_seconds + greatest(0,
        extract(epoch from (now() - last_server_signal_at))
        - case
            when status = 'in_progress'
                 and extract(epoch from (now() - last_server_signal_at)) > 90
            then least(
                   extract(epoch from (now() - last_server_signal_at)),
                   background_budget_remaining_seconds
                 )
            else 0
          end
    ),
    background_budget_remaining_seconds = greatest(0,
        background_budget_remaining_seconds - case
            when status = 'in_progress'
                 and extract(epoch from (now() - last_server_signal_at)) > 90
            then least(
                   extract(epoch from (now() - last_server_signal_at)),
                   background_budget_remaining_seconds
                 )
            else 0
          end
    ),
    last_server_signal_at = now(),
    status                = 'submitted',
    submitted_at          = now(),
    score                 = p_score
  where id = p_attempt_id
    and session_token = p_session_token
    and status in ('in_progress', 'background')
    and refund_requested_at is null
  returning user_id, child_id, score, accumulated_time_seconds
    into v_user_id, v_child_id, v_score, v_accumulated;

  v_first_submit := found;

  if v_first_submit then
    -- 최초 제출 확정. 리더보드 누적은 (a) identity를 확보했고 (b) 이 attempt가
    -- 어떤 아이의 것인지 서버가 알고 있을 때만 한다.
    if p_name is not null and p_login_id is not null and v_child_id is not null then

      -- attempt_id 원장 선점. 이미 누적된 attempt면 0행 삽입 → 재누적하지 않는다.
      insert into quiz_leaderboard_attempts (attempt_id, child_id, score, time_seconds)
      values (p_attempt_id, v_child_id, v_score, v_accumulated)
      on conflict (attempt_id) do nothing;

      v_newly_counted := found;

      if v_newly_counted then
        insert into quiz_leaderboard as ql
          (child_id, user_id, name, login_id, is_seed_user, is_reward_eligible,
           cumulative_score, cumulative_time, completed_attempts)
        values
          (v_child_id, v_user_id, p_name, p_login_id, false, true,
           v_score, v_accumulated, 1)
        on conflict (child_id) do update set
          user_id            = excluded.user_id,
          name               = excluded.name,
          login_id           = excluded.login_id,
          cumulative_score   = ql.cumulative_score   + excluded.cumulative_score,
          cumulative_time    = ql.cumulative_time    + excluded.cumulative_time,
          completed_attempts = ql.completed_attempts + 1,
          updated_at         = now()
        returning ql.cumulative_score, ql.cumulative_time, ql.completed_attempts
          into v_cum_score, v_cum_time, v_cum_attempts;
      else
        select ql.cumulative_score, ql.cumulative_time, ql.completed_attempts
          into v_cum_score, v_cum_time, v_cum_attempts
        from quiz_leaderboard ql
        where ql.child_id = v_child_id;
      end if;
    end if;

    return query
      select v_score, v_accumulated, v_cum_score, v_cum_time, v_cum_attempts, false, true;
    return;
  end if;

  -- No active row updated. Re-read to distinguish "already submitted by this
  -- same session" (idempotent success) from "wrong token / refunded".
  select qa.score, qa.accumulated_time_seconds, qa.user_id, qa.child_id
    into v_score, v_accumulated, v_user_id, v_child_id
  from quiz_attempts qa
  where qa.id = p_attempt_id
    and qa.session_token = p_session_token
    and qa.status = 'submitted';

  if found then
    -- 재제출/새로고침/콜백 재시도: 절대 누적하지 않고 현재 누적치만 다시 읽어준다.
    select ql.cumulative_score, ql.cumulative_time, ql.completed_attempts
      into v_cum_score, v_cum_time, v_cum_attempts
    from quiz_leaderboard ql
    where ql.child_id = v_child_id;

    return query
      select v_score, v_accumulated,
             coalesce(v_cum_score, 0),
             coalesce(v_cum_time, 0::double precision),
             coalesce(v_cum_attempts, 0),
             true, true;
    return;
  end if;

  -- Nothing matched this attempt_id + session_token in any state.
  return query
    select null::int, null::double precision, null::int,
           null::double precision, null::int, false, false;
end;
$function$;

grant execute on function public.quiz_submit_attempt(uuid, text, integer, text, text)
  to postgres, anon, authenticated, service_role;

commit;
