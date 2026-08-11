-- event_reward_fulfillments의 unique 제약을 (event_type, event_reference_id)에서
-- (event_type, event_reference_id, child_id)로 확장한다.
--
-- 배경: 퀴즈 리더보드 지급 대상을 quiz_leaderboard_final_entries에서 동기화하려 했으나
-- 그 테이블은 id 컬럼이 없고 PK가 (snapshot_id, rank) 복합키다(퀴즈마스터 소유 테이블,
-- 별도 레포 마이그레이션). event_reference_id는 uuid 단일 컬럼이라 snapshot_id를 쓸 수밖에
-- 없는데, 같은 snapshot_id 아래 1·2·3위 세 명이 있으므로 기존 제약(event_type,
-- event_reference_id)만으로는 첫 번째 지급 대상만 들어가고 나머지 두 명이 막힌다.
-- child_id를 제약에 포함시켜 "같은 snapshot(event_reference_id) 안에서도 아이별로는
-- 유일"하게 바꾼다. 미션 온보딩 이벤트는 원래도 event_reference_id(=event.id)가
-- child_id와 1:1이라 이 변경으로 기존 동작이 달라지지 않는다.

begin;

alter table public.event_reward_fulfillments
  drop constraint if exists event_reward_fulfillments_ref_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_reward_fulfillments_ref_child_unique'
  ) then
    alter table public.event_reward_fulfillments
      add constraint event_reward_fulfillments_ref_child_unique
      unique (event_type, event_reference_id, child_id);
  end if;
end $$;

commit;
