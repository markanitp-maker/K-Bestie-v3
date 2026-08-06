-- 20260806183000_revoke_anon_auth_child_temporal_context.sql
-- Security Hardening: Revoke client direct table grants on child_temporal_context
-- Table access is strictly restricted to backend service_role in API routes.

REVOKE ALL ON public.child_temporal_context FROM anon, authenticated;
GRANT ALL ON public.child_temporal_context TO service_role;

ALTER TABLE public.child_temporal_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "child_temporal_context_service_all" ON public.child_temporal_context;
DROP POLICY IF EXISTS "child_temporal_context_service_role_only" ON public.child_temporal_context;

CREATE POLICY "child_temporal_context_service_role_only"
ON public.child_temporal_context
FOR ALL
TO service_role
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
