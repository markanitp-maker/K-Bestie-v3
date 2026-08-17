-- a07 시드가 만든 **오늘분만** 되돌린다.
-- 오늘을 미리 완료 처리해서 대표가 오늘 미션을 할 수 없게 됐다.
-- 대상은 전부 a07 시드의 결정적 UUID / generation_source='demo' / event_key 접두사로
-- 특정되므로 실제 데이터는 건드리지 않는다.
WITH kids AS (
  SELECT unnest(ARRAY[
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9','cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410',
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a','77ca8f14-e916-41b6-99f8-63003d13f021',
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[]) AS cid
), t AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
-- 1) report_views (daily_reports FK)
del_views AS (
  DELETE FROM public.report_views v
  USING public.daily_reports r, t
  WHERE v.report_id = r.id AND r.generation_source = 'demo'
    AND r.business_date = t.d AND r.child_id IN (SELECT cid FROM kids)
  RETURNING v.id
),
-- 2) daily_reports
del_reports AS (
  DELETE FROM public.daily_reports r USING t
  WHERE r.generation_source = 'demo' AND r.business_date = t.d
    AND r.child_id IN (SELECT cid FROM kids)
  RETURNING r.id
),
-- 3) behavior_events (a07 시드가 만든 것만)
del_events AS (
  DELETE FROM public.behavior_events e USING t
  WHERE e.event_key LIKE 'a07-demo:%'
    AND (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date = t.d
  RETURNING e.id
),
-- 4) mission_progress (시드 세션 id 인 것만)
del_mp AS (
  DELETE FROM public.mission_progress mp USING t
  WHERE mp.child_id IN (SELECT cid FROM kids)
    AND mp.business_date = t.d::text
    AND mp.session_id = uuid_generate_v5(
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'a07-demo:session:' || mp.child_id::text || ':' || mp.business_date)
  RETURNING mp.session_id
),
-- 5) chat_sessions (시드가 만든 것만, 위 FK 제거 후)
del_cs AS (
  DELETE FROM public.chat_sessions s USING t
  WHERE s.child_id IN (SELECT cid FROM kids)
    AND s.id = uuid_generate_v5(
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'a07-demo:session:' || s.child_id::text || ':' || t.d::text)
  RETURNING s.id
)
SELECT
  (SELECT count(*) FROM del_views)   AS 삭제_열람,
  (SELECT count(*) FROM del_reports) AS 삭제_리포트,
  (SELECT count(*) FROM del_events)  AS 삭제_이벤트,
  (SELECT count(*) FROM del_mp)      AS 삭제_미션,
  (SELECT count(*) FROM del_cs)      AS 삭제_세션;
