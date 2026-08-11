CREATE TABLE IF NOT EXISTS public.acquisition_links (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    link_id text NOT NULL UNIQUE,
    channel_name text NOT NULL,
    utm_source text NOT NULL,
    utm_medium text NOT NULL,
    utm_campaign text NOT NULL,
    utm_content text,
    purpose text,
    destination_path text NOT NULL DEFAULT '/signup',
    status text NOT NULL DEFAULT 'ACTIVE',
    memo text,
    starts_at timestamptz,
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by uuid,
    delete_reason text
);
ALTER TABLE public.acquisition_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acquisition_links_service_all ON public.acquisition_links;
CREATE POLICY acquisition_links_service_all ON public.acquisition_links FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.parent_attributions (
    parent_user_id uuid NOT NULL PRIMARY KEY,
    first_touch_link_id text,
    first_touch_at timestamptz,
    signup_link_id text,
    signup_touch_at timestamptz,
    attribution_window_days int NOT NULL DEFAULT 30,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parent_attributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parent_attributions_service_all ON public.parent_attributions;
CREATE POLICY parent_attributions_service_all ON public.parent_attributions FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.acquisition_visits (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    link_id text NOT NULL,
    visitor_id text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    landing_path text,
    referrer text,
    user_agent_category text,
    device_category text,
    is_internal_test boolean DEFAULT false,
    ip_hash text
);
CREATE INDEX IF NOT EXISTS idx_acq_visits_link_id ON public.acquisition_visits(link_id);
CREATE INDEX IF NOT EXISTS idx_acq_visits_visitor_id ON public.acquisition_visits(visitor_id);
ALTER TABLE public.acquisition_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acquisition_visits_service_all ON public.acquisition_visits;
CREATE POLICY acquisition_visits_service_all ON public.acquisition_visits FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.acquisition_events (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type text NOT NULL,
    attribution_id text NOT NULL,
    visitor_id text NOT NULL,
    link_id text NOT NULL,
    parent_user_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acq_events_attr_id ON public.acquisition_events(attribution_id);
CREATE INDEX IF NOT EXISTS idx_acq_events_parent_id ON public.acquisition_events(parent_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acq_events_parent_signup ON public.acquisition_events(event_type, parent_user_id) WHERE event_type = 'PARENT_SIGNUP_COMPLETED';
ALTER TABLE public.acquisition_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acquisition_events_service_all ON public.acquisition_events;
CREATE POLICY acquisition_events_service_all ON public.acquisition_events FOR ALL USING (auth.role() = 'service_role');
