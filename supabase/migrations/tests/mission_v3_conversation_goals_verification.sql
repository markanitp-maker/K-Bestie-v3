-- 073 Mission v3 Goal regression verification.
-- Run only against an isolated/local schema after all migrations. Never run
-- against Dev/Production. Every fixture is rolled back.
BEGIN;

DO $$
DECLARE
  v_owner_id uuid := gen_random_uuid();
  v_family_id uuid := gen_random_uuid();
  v_cleanup_child_id uuid := gen_random_uuid();
  v_cleanup_session_id uuid := gen_random_uuid();
  v_cleanup_message_id uuid := gen_random_uuid();
  v_cleanup_goal_id uuid := gen_random_uuid();
  v_delete_child_id uuid := gen_random_uuid();
  v_delete_session_id uuid := gen_random_uuid();
  v_delete_message_id uuid := gen_random_uuid();
  v_delete_goal_id uuid := gen_random_uuid();
  v_deleted_count integer;
  v_policy_count integer;
  v_constraint_definition text;
  v_delete_result record;
BEGIN
  -- R-1: RLS-bound roles have no readable policy. service_role bypasses RLS.
  SELECT count(*)::integer INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'conversation_goals';
  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'conversation_goals expected one deny-all policy, got %', v_policy_count;
  END IF;

  SELECT count(*)::integer INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'conversation_goals'
    AND policyname = 'conversation_goals_service_all'
    AND qual = 'false'
    AND with_check = 'false';
  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'conversation_goals deny-all RLS policy is missing';
  END IF;

  -- R-2: SATISFIED evidence keeps durable metadata while source_turn_id is a
  -- nullable reference that may be cleared by chat retention.
  SELECT pg_get_constraintdef(oid) INTO v_constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'public.conversation_goals'::regclass
    AND conname = 'conversation_goals_satisfied_evidence_check';
  IF v_constraint_definition IS NULL
     OR v_constraint_definition ILIKE '%source_turn_id%'
     OR v_constraint_definition NOT ILIKE '%evidence_source%'
     OR v_constraint_definition NOT ILIKE '%confidence%'
     OR v_constraint_definition NOT ILIKE '%satisfied_at%' THEN
    RAISE EXCEPTION 'SATISFIED evidence constraint mismatch: %', v_constraint_definition;
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (v_owner_id, format('mission-v3-%s@example.test', v_owner_id));
  INSERT INTO public.families (id, name, created_by)
  VALUES (v_family_id, 'ROLLBACK-073-GOAL-QA', v_owner_id);
  INSERT INTO public.family_members (family_id, user_id, role)
  VALUES (v_family_id, v_owner_id, 'owner_parent');

  -- cleanup_chat_messages_v3 must delete evidence without violating the Goal CHECK.
  INSERT INTO public.child_profiles (id, family_id, name, grade)
  VALUES (v_cleanup_child_id, v_family_id, 'ROLLBACK-073-CLEANUP', '초1');
  INSERT INTO public.chat_sessions (id, child_id, session_type)
  VALUES (v_cleanup_session_id, v_cleanup_child_id, 'mission');
  INSERT INTO public.chat_messages (
    id, session_id, role, content, created_at, collected_at
  ) VALUES (
    v_cleanup_message_id,
    v_cleanup_session_id,
    'child',
    'Goal evidence cleanup fixture',
    now() - interval '100 years',
    now() - interval '100 years'
  );
  INSERT INTO public.conversation_goals (
    goal_id, mission_session_id, child_id, goal_order, semantic_group,
    priority, status, evidence_source, source_turn_id, confidence, satisfied_at
  ) VALUES (
    v_cleanup_goal_id, v_cleanup_session_id, v_cleanup_child_id, 1,
    'CLEANUP_EVIDENCE', 'P1', 'SATISFIED', 'child_utterance',
    v_cleanup_message_id, 0.900, now()
  );

  SELECT public.cleanup_chat_messages_v3(now() - interval '99 years', 10)
  INTO v_deleted_count;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'cleanup_chat_messages_v3 expected one fixture delete, got %', v_deleted_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE id = v_cleanup_message_id) THEN
    RAISE EXCEPTION 'cleanup_chat_messages_v3 did not delete evidence message';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversation_goals
    WHERE goal_id = v_cleanup_goal_id
      AND status = 'SATISFIED'
      AND source_turn_id IS NULL
      AND evidence_source = 'child_utterance'
      AND confidence = 0.900
      AND satisfied_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SATISFIED Goal did not retain nullable evidence metadata after cleanup';
  END IF;

  -- delete_child_profile deletes chat_messages before chat_sessions. The same
  -- SET NULL transition must succeed before session cascade removes the Goal.
  INSERT INTO public.child_profiles (id, family_id, name, grade)
  VALUES (v_delete_child_id, v_family_id, 'ROLLBACK-073-DELETE', '초1');
  INSERT INTO public.chat_sessions (id, child_id, session_type)
  VALUES (v_delete_session_id, v_delete_child_id, 'mission');
  INSERT INTO public.chat_messages (id, session_id, role, content)
  VALUES (v_delete_message_id, v_delete_session_id, 'child', 'Goal delete fixture');
  INSERT INTO public.conversation_goals (
    goal_id, mission_session_id, child_id, goal_order, semantic_group,
    priority, status, evidence_source, source_turn_id, confidence, satisfied_at
  ) VALUES (
    v_delete_goal_id, v_delete_session_id, v_delete_child_id, 1,
    'DELETE_PROFILE_EVIDENCE', 'P1', 'SATISFIED', 'child_utterance',
    v_delete_message_id, 0.900, now()
  );

  SELECT * INTO v_delete_result
  FROM public.delete_child_profile(v_delete_child_id, v_owner_id);
  IF NOT v_delete_result.success THEN
    RAISE EXCEPTION 'delete_child_profile failed: %', v_delete_result.reason;
  END IF;
  IF EXISTS (SELECT 1 FROM public.child_profiles WHERE id = v_delete_child_id)
     OR EXISTS (SELECT 1 FROM public.conversation_goals WHERE goal_id = v_delete_goal_id) THEN
    RAISE EXCEPTION 'delete_child_profile left Goal fixture rows behind';
  END IF;
END;
$$;

ROLLBACK;
