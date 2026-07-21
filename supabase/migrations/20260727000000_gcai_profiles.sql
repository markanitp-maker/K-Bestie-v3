CREATE TABLE IF NOT EXISTS public.gcai_profiles (
    profile TEXT PRIMARY KEY CHECK (profile IN ('A', 'B')),
    google_cloud_project TEXT,
    google_cloud_location TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    last_health_check_at TIMESTAMPTZ,
    last_health_check_result JSONB
);

ALTER TABLE public.gcai_profiles ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'gcai_profiles' AND schemaname = 'public' AND policyname = 'service_role_all_policy'
    ) THEN
        CREATE POLICY "service_role_all_policy" ON public.gcai_profiles
            AS PERMISSIVE FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;

INSERT INTO public.gcai_profiles (profile, google_cloud_project, google_cloud_location, is_active)
VALUES
    ('A', NULL, NULL, true),
    ('B', NULL, NULL, false)
ON CONFLICT (profile) DO NOTHING;
