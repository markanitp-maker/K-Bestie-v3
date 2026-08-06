CREATE TABLE IF NOT EXISTS public.parent_k_chat_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text,
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_intent text,
  requested_topic text,
  requested_area text,
  router_route text,
  router_rule_id text,
  safe_alternative_area text,
  pending_parent_draft text,
  pending_child_question text,
  pending_status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parent_k_chat_drafts ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.parent_k_chat_drafts TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'parent_k_chat_drafts' AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY service_role_only ON public.parent_k_chat_drafts
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
