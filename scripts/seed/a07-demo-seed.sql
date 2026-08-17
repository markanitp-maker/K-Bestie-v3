-- ==============================================================================
-- K-Bestie v3 Production Demo Seed SQL (a07)
-- Target: is_internal_test=true Families (테스트 가족, QA 부모 전용 가족)
-- Idempotency: Deterministic UUIDv5 + ON CONFLICT DO NOTHING
-- Safety: READ/INSERT ONLY (NO UPDATE, NO DELETE, NO REAL USER DATA MUTATION)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- BEGIN; (apply-migration.js 가 암묵적 트랜잭션으로 감싼다)

-- ------------------------------------------------------------------------------
-- CTE: 대상 아이 및 날짜 시리즈 생성 (가입일 ~ 오늘 KST)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    cp.name AS child_name,
    cp.family_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date,
    (
      SELECT fm.user_id
      FROM public.family_members fm
      WHERE fm.family_id = cp.family_id
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.user_id IS NOT NULL
      ORDER BY CASE WHEN fm.role = 'owner_parent' THEN 1 ELSE 2 END, fm.created_at ASC
      LIMIT 1
    ) AS parent_user_id
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid, -- 박서아
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid, -- 박서현
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid, -- 박서둥
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid, -- 박말똥
    '11111111-1111-1111-1111-111111111111'::uuid, -- TestA
    '22222222-2222-2222-2222-222222222222'::uuid  -- TestB
  )
    AND cp.family_id IN (
      '53db02cc-7a52-4368-9e5a-3334a9b3710f'::uuid, -- 테스트 가족
      'f6ea0977-d80a-4265-a3f3-49952e0f6d3d'::uuid  -- QA 부모 전용 가족
    )
),
child_dates AS (
  SELECT
    tc.child_id,
    tc.child_name,
    tc.family_id,
    tc.parent_user_id,
    d::date AS business_date,
    (d::date::text || ' 10:00:00+09')::timestamptz AS mission_start_at,
    (d::date::text || ' 10:15:00+09')::timestamptz AS mission_end_at,
    (d::date::text || ' 10:16:00+09')::timestamptz AS report_created_at,
    (d::date::text || ' 20:00:00+09')::timestamptz AS report_viewed_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:session:' || tc.child_id::text || ':' || d::date::text) AS session_id,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:report:' || tc.child_id::text || ':' || d::date::text) AS report_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)

-- ------------------------------------------------------------------------------
-- 1. chat_sessions (DEMO 미션 세션)
-- ------------------------------------------------------------------------------
INSERT INTO public.chat_sessions (
  id,
  child_id,
  started_at,
  ended_at,
  turn_count,
  session_type,
  demo_mode,
  business_date,
  conversation_window,
  test_mode
)
SELECT
  cd.session_id,
  cd.child_id,
  cd.mission_start_at,
  cd.mission_end_at,
  10 AS turn_count,
  'mission' AS session_type,
  true AS demo_mode,
  cd.business_date,
  'day' AS conversation_window,
  'A' AS test_mode
FROM child_dates cd
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. mission_progress (완료 상태 미션 게이지)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    d::date AS business_date,
    (d::date::text || ' 10:00:00+09')::timestamptz AS mission_start_at,
    (d::date::text || ' 10:15:00+09')::timestamptz AS mission_end_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:session:' || tc.child_id::text || ':' || d::date::text) AS session_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.mission_progress (
  session_id,
  child_id,
  business_date,
  valid_answer_count,
  required_valid_count,
  question_ids,
  question_states,
  round_type,
  status,
  engine_version,
  mission_policy_version,
  effective_at,
  created_at,
  updated_at
)
SELECT
  cd.session_id,
  cd.child_id,
  cd.business_date::text,
  5 AS valid_answer_count,
  5 AS required_valid_count,
  '{}'::uuid[] AS question_ids,
  '{}'::jsonb AS question_states,
  'daily_single' AS round_type,
  'COMPLETED' AS status,
  'v3' AS engine_version,
  'v3_single_daily' AS mission_policy_version,
  cd.mission_start_at AS effective_at,
  cd.mission_start_at AS created_at,
  cd.mission_end_at AS updated_at
FROM child_dates cd
-- mission_progress 에는 PK(session_id) 말고도 부분 unique 인덱스가 있다:
--   (child_id, business_date) WHERE round_type='daily_single'
-- 데모 아이들에게 이미 그날 실제 기록이 있으면 PK 충돌이 아니라 이 인덱스에서 막힌다.
-- **기존 기록을 덮어쓰지 않고 건너뛴다.** 실제 데이터를 보존하는 쪽이 우선이다.
ON CONFLICT (child_id, business_date) WHERE round_type = 'daily_single' DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. behavior_events (아이의 미션 시작 및 완료 이벤트 2건)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    cp.family_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    tc.family_id,
    d::date AS business_date,
    (d::date::text || ' 10:00:00+09')::timestamptz AS mission_start_at,
    (d::date::text || ' 10:15:00+09')::timestamptz AS mission_end_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:session:' || tc.child_id::text || ':' || d::date::text) AS session_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.behavior_events (
  id,
  event_name,
  actor_type,
  actor_id,
  family_id,
  child_id,
  session_id,
  feature,
  occurred_at,
  duration_seconds,
  environment,
  is_test_account,
  event_key,
  properties,
  created_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:be-mission-start:' || cd.child_id::text || ':' || cd.business_date::text) AS id,
  'mission_start' AS event_name,
  'child' AS actor_type,
  NULL::uuid AS actor_id,
  cd.family_id,
  cd.child_id,
  cd.session_id,
  'mission' AS feature,
  cd.mission_start_at AS occurred_at,
  NULL::integer AS duration_seconds,
  'prod' AS environment,
  true AS is_test_account,
  'a07-demo:mission_start:' || cd.child_id::text || ':' || cd.business_date::text AS event_key,
  jsonb_build_object('demo', true, 'session_type', 'mission', 'business_date', cd.business_date::text) AS properties,
  cd.mission_start_at AS created_at
FROM child_dates cd
ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING;

WITH target_children AS (
  SELECT
    cp.id AS child_id,
    cp.family_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    tc.family_id,
    d::date AS business_date,
    (d::date::text || ' 10:15:00+09')::timestamptz AS mission_end_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:session:' || tc.child_id::text || ':' || d::date::text) AS session_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.behavior_events (
  id,
  event_name,
  actor_type,
  actor_id,
  family_id,
  child_id,
  session_id,
  feature,
  occurred_at,
  duration_seconds,
  environment,
  is_test_account,
  event_key,
  properties,
  created_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:be-mission-complete:' || cd.child_id::text || ':' || cd.business_date::text) AS id,
  'mission_complete' AS event_name,
  'child' AS actor_type,
  NULL::uuid AS actor_id,
  cd.family_id,
  cd.child_id,
  cd.session_id,
  'mission' AS feature,
  cd.mission_end_at AS occurred_at,
  900 AS duration_seconds,
  'prod' AS environment,
  true AS is_test_account,
  'a07-demo:mission_complete:' || cd.child_id::text || ':' || cd.business_date::text AS event_key,
  jsonb_build_object('demo', true, 'session_type', 'mission', 'business_date', cd.business_date::text, 'valid_answer_count', 5) AS properties,
  cd.mission_end_at AS created_at
FROM child_dates cd
ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. daily_reports (정상 렌더링 payload 및 DEMO 식별 메타데이터)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    d::date AS business_date,
    (d::date::text || ' 10:15:00+09')::timestamptz AS mission_end_at,
    (d::date::text || ' 10:16:00+09')::timestamptz AS report_created_at,
    (d::date::text || ' 20:00:00+09')::timestamptz AS report_viewed_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:session:' || tc.child_id::text || ':' || d::date::text) AS session_id,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:report:' || tc.child_id::text || ':' || d::date::text) AS report_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.daily_reports (
  id,
  child_id,
  session_id,
  business_date,
  summary_line,
  mood_score,
  emotion_tags,
  parent_guide,
  emotion_level,
  dashboard_cards,
  school_academy_life,
  peer_friendship,
  emotion_hint,
  interests_preferences,
  study_concerns,
  digital_content_interests,
  future_dreams,
  recurring_stories,
  generation_source,
  generation_version,
  source_data_updated_at,
  created_at,
  viewed_at
)
SELECT
  cd.report_id,
  cd.child_id,
  cd.session_id,
  cd.business_date,
  '오늘도 친구들과 즐겁고 활기찬 하루를 보냈어요!' AS summary_line,
  8 AS mood_score,
  ARRAY['즐거움', '뿌듯함', '편안함']::text[] AS emotion_tags,
  '오늘 하루 동안 있었던 재미있는 일을 아이와 따뜻하게 이야기 나누어 보세요.' AS parent_guide,
  'safe' AS emotion_level,
  jsonb_build_object(
    'school_academy_life', '학교에서 친구들과 함께 즐겁게 활동했어요.',
    'peer_friendship', '새로운 놀이를 하며 친구들과 사이좋게 어울렸어요.',
    'emotion_hint', '오늘 기분은 매우 긍정적이고 안정적이에요.',
    'interests_preferences', '좋아하는 주제에 대해 흥미진진하게 이야기했어요.',
    'study_concerns', '어려운 문제도 차근차근 해결하려는 모습을 보였어요.',
    'digital_content_interests', '재미있는 콘텐츠에 대해 이야기하며 생각을 나누었어요.',
    'future_dreams', '앞으로 해보고 싶은 일에 대해 밝은 기대를 표현했어요.',
    'recurring_stories', '친구들과의 일상을 자주 이야기하고 있어요.'
  ) AS dashboard_cards,
  '학교에서 친구들과 함께 즐겁게 활동했어요.' AS school_academy_life,
  '새로운 놀이를 하며 친구들과 사이좋게 어울렸어요.' AS peer_friendship,
  '오늘 기분은 매우 긍정적이고 안정적이에요.' AS emotion_hint,
  '좋아하는 주제에 대해 흥미진진하게 이야기했어요.' AS interests_preferences,
  '어려운 문제도 차근차근 해결하려는 모습을 보였어요.' AS study_concerns,
  '재미있는 콘텐츠에 대해 이야기하며 생각을 나누었어요.' AS digital_content_interests,
  '앞으로 해보고 싶은 일에 대해 밝은 기대를 표현했어요.' AS future_dreams,
  '친구들과의 일상을 자주 이야기하고 있어요.' AS recurring_stories,
  'demo' AS generation_source,
  1 AS generation_version,
  cd.mission_end_at AS source_data_updated_at,
  cd.report_created_at AS created_at,
  cd.report_viewed_at AS viewed_at
FROM child_dates cd
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. report_views (부모의 리포트 1회 열람 기록)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date,
    (
      SELECT fm.user_id
      FROM public.family_members fm
      WHERE fm.family_id = cp.family_id
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.user_id IS NOT NULL
      ORDER BY CASE WHEN fm.role = 'owner_parent' THEN 1 ELSE 2 END, fm.created_at ASC
      LIMIT 1
    ) AS parent_user_id
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    tc.parent_user_id,
    d::date AS business_date,
    (d::date::text || ' 20:00:00+09')::timestamptz AS report_viewed_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:report:' || tc.child_id::text || ':' || d::date::text) AS report_id,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:view:' || tc.child_id::text || ':' || d::date::text) AS view_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.report_views (
  id,
  report_id,
  viewer_id,
  viewed_at
)
SELECT
  cd.view_id,
  cd.report_id,
  cd.parent_user_id,
  cd.report_viewed_at
FROM child_dates cd
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 6. behavior_events (부모의 일일 리포트 열람 이벤트)
-- ------------------------------------------------------------------------------
WITH target_children AS (
  SELECT
    cp.id AS child_id,
    cp.family_id,
    (cp.created_at AT TIME ZONE 'Asia/Seoul')::date AS signup_date,
    (
      SELECT fm.user_id
      FROM public.family_members fm
      WHERE fm.family_id = cp.family_id
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.user_id IS NOT NULL
      ORDER BY CASE WHEN fm.role = 'owner_parent' THEN 1 ELSE 2 END, fm.created_at ASC
      LIMIT 1
    ) AS parent_user_id
  FROM public.child_profiles cp
  WHERE cp.id IN (
    '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
    'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
    '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
    '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  )
),
child_dates AS (
  SELECT
    tc.child_id,
    tc.family_id,
    tc.parent_user_id,
    d::date AS business_date,
    (d::date::text || ' 20:00:00+09')::timestamptz AS report_viewed_at,
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:report:' || tc.child_id::text || ':' || d::date::text) AS report_id
  FROM target_children tc
  CROSS JOIN LATERAL generate_series(
    tc.signup_date,
    (now() AT TIME ZONE 'Asia/Seoul')::date,
    '1 day'::interval
  ) AS d
)
INSERT INTO public.behavior_events (
  id,
  event_name,
  actor_type,
  actor_id,
  family_id,
  child_id,
  session_id,
  feature,
  occurred_at,
  duration_seconds,
  environment,
  is_test_account,
  event_key,
  properties,
  created_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'a07-demo:be-parent-view:' || cd.child_id::text || ':' || cd.business_date::text) AS id,
  'parent_report_view' AS event_name,
  'parent' AS actor_type,
  cd.parent_user_id AS actor_id,
  cd.family_id,
  cd.child_id,
  NULL::uuid AS session_id,
  'daily_report' AS feature,
  cd.report_viewed_at AS occurred_at,
  45 AS duration_seconds,
  'prod' AS environment,
  true AS is_test_account,
  'a07-demo:parent_report_view:' || cd.child_id::text || ':' || cd.business_date::text AS event_key,
  jsonb_build_object('demo', true, 'report_id', cd.report_id::text, 'business_date', cd.business_date::text) AS properties,
  cd.report_viewed_at AS created_at
FROM child_dates cd
ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING;

-- COMMIT; (동상)

-- ==============================================================================
-- [검증 쿼리 1] 아이별 4개 지표 일치 확인 (가입일~오늘 날짜 수 = 미션완료 = 리포트 = 열람)
-- ==============================================================================
/*
SELECT
  cp.id AS child_id,
  cp.name AS child_name,
  ((now() AT TIME ZONE 'Asia/Seoul')::date - (cp.created_at AT TIME ZONE 'Asia/Seoul')::date + 1) AS expected_days,
  COUNT(DISTINCT DATE(cs.started_at AT TIME ZONE 'Asia/Seoul')) FILTER (WHERE mp.status = 'COMPLETED') AS mission_completed_days,
  COUNT(DISTINCT dr.business_date) AS daily_reports_days,
  COUNT(DISTINCT DATE(be_view.occurred_at AT TIME ZONE 'Asia/Seoul')) AS parent_report_view_days,
  CASE
    WHEN ((now() AT TIME ZONE 'Asia/Seoul')::date - (cp.created_at AT TIME ZONE 'Asia/Seoul')::date + 1)
       = COUNT(DISTINCT DATE(cs.started_at AT TIME ZONE 'Asia/Seoul')) FILTER (WHERE mp.status = 'COMPLETED')
     AND ((now() AT TIME ZONE 'Asia/Seoul')::date - (cp.created_at AT TIME ZONE 'Asia/Seoul')::date + 1)
       = COUNT(DISTINCT dr.business_date)
     AND ((now() AT TIME ZONE 'Asia/Seoul')::date - (cp.created_at AT TIME ZONE 'Asia/Seoul')::date + 1)
       = COUNT(DISTINCT DATE(be_view.occurred_at AT TIME ZONE 'Asia/Seoul'))
    THEN 'PASS'
    ELSE 'FAIL'
  END AS validation_status
FROM public.child_profiles cp
LEFT JOIN public.chat_sessions cs
  ON cs.child_id = cp.id AND cs.demo_mode = true
LEFT JOIN public.mission_progress mp
  ON mp.session_id = cs.id
LEFT JOIN public.daily_reports dr
  ON dr.child_id = cp.id AND dr.generation_source = 'demo'
LEFT JOIN public.behavior_events be_view
  ON be_view.child_id = cp.id AND be_view.event_name = 'parent_report_view' AND be_view.is_test_account = true
WHERE cp.id IN (
  '2f98d390-e690-452d-8cd2-8e1f9cac09f9'::uuid,
  'cd7acbcc-2fb9-46e4-ac1e-dbd991f7b410'::uuid,
  '79b4dad8-a0b5-475f-836a-564fb4a6de2a'::uuid,
  '77ca8f14-e916-41b6-99f8-63003d13f021'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid
)
GROUP BY cp.id, cp.name, cp.created_at
ORDER BY cp.created_at ASC;
*/

-- ==============================================================================
-- [검증 쿼리 2] 운영 가족 데이터 무변경 확인 (2개 테스트 가족 외 데이터 0건 생성/영향 검증)
-- ==============================================================================
/*
SELECT
  'chat_sessions' AS table_name,
  COUNT(*) AS foreign_rows_count
FROM public.chat_sessions cs
JOIN public.child_profiles cp ON cp.id = cs.child_id
WHERE cs.demo_mode = true
  AND cp.family_id NOT IN (
    '53db02cc-7a52-4368-9e5a-3334a9b3710f'::uuid,
    'f6ea0977-d80a-4265-a3f3-49952e0f6d3d'::uuid
  )
UNION ALL
SELECT
  'daily_reports' AS table_name,
  COUNT(*) AS foreign_rows_count
FROM public.daily_reports dr
JOIN public.child_profiles cp ON cp.id = dr.child_id
WHERE dr.generation_source = 'demo'
  AND cp.family_id NOT IN (
    '53db02cc-7a52-4368-9e5a-3334a9b3710f'::uuid,
    'f6ea0977-d80a-4265-a3f3-49952e0f6d3d'::uuid
  )
UNION ALL
SELECT
  'behavior_events' AS table_name,
  COUNT(*) AS foreign_rows_count
FROM public.behavior_events be
WHERE be.event_key LIKE 'a07-demo:%'
  AND (
    be.family_id NOT IN (
      '53db02cc-7a52-4368-9e5a-3334a9b3710f'::uuid,
      'f6ea0977-d80a-4265-a3f3-49952e0f6d3d'::uuid
    )
    OR be.family_id IS NULL
  );
*/
