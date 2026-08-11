-- 073 Mission v3 Phase 1: additive Conversation Goal entity only.
-- Existing mission_progress/chat_sessions/parent_questions rows and schemas are untouched.

CREATE TABLE IF NOT EXISTS public.conversation_goals (
  goal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_session_id uuid NOT NULL
    REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  child_id uuid NOT NULL
    REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  goal_order smallint NOT NULL CHECK (goal_order BETWEEN 1 AND 4),
  semantic_group text NOT NULL CHECK (length(btrim(semantic_group)) > 0),
  priority text NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SATISFIED', 'PARTIAL', 'DECLINED', 'SKIPPED')),
  evidence_source text
    CHECK (evidence_source IS NULL OR evidence_source IN ('child_utterance', 'parent_question', 'memory', 'system')),
  source_turn_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  confidence numeric(4, 3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  satisfied_at timestamptz,
  parent_question_id uuid REFERENCES public.parent_questions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_goals_session_order_key UNIQUE (mission_session_id, goal_order),
  CONSTRAINT conversation_goals_session_semantic_key UNIQUE (mission_session_id, semantic_group),
  CONSTRAINT conversation_goals_p0_parent_source_check CHECK (
    priority <> 'P0' OR parent_question_id IS NOT NULL
  ),
  CONSTRAINT conversation_goals_satisfied_evidence_check CHECK (
    status <> 'SATISFIED'
    OR (
      evidence_source IS NOT NULL
      AND confidence IS NOT NULL
      AND satisfied_at IS NOT NULL
    )
  ),
  CONSTRAINT conversation_goals_satisfied_at_check CHECK (
    satisfied_at IS NULL OR status = 'SATISFIED'
  )
);

CREATE INDEX IF NOT EXISTS conversation_goals_child_status_idx
  ON public.conversation_goals (child_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_goals_parent_question_idx
  ON public.conversation_goals (parent_question_id)
  WHERE parent_question_id IS NOT NULL;

ALTER TABLE public.conversation_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_goals_family_select
  ON public.conversation_goals;

DROP POLICY IF EXISTS conversation_goals_service_all
  ON public.conversation_goals;

-- service_role bypasses RLS. Explicitly deny every RLS-bound role so hidden Goal
-- metadata cannot be read directly with either a child or parent JWT.
DROP POLICY IF EXISTS conversation_goals_service_all ON public.conversation_goals;
CREATE POLICY conversation_goals_service_all
  ON public.conversation_goals
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.conversation_goals TO anon, authenticated;

COMMENT ON TABLE public.conversation_goals IS
  'Mission v3 hidden Conversation Goals. The child-facing conversation must not expose priority or parent-question provenance.';
