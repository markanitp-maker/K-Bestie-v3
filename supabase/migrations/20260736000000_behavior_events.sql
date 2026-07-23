-- K-Bestie-v3 부모/아이/가족 행동 분석 이벤트 원본 데이터용 테이블
-- (기존 usage_events는 비용 원장용이므로 절대 통합하지 않고 새로 만듦)

CREATE TABLE IF NOT EXISTS public.behavior_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name        TEXT NOT NULL,
    actor_type        TEXT NOT NULL CHECK (actor_type IN ('parent','child','system','admin')),
    actor_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,   -- system 이벤트는 NULL
    family_id         UUID REFERENCES public.families(id) ON DELETE SET NULL,
    child_id          UUID REFERENCES public.child_profiles(id) ON DELETE SET NULL,
    session_id        UUID,   -- chat_sessions.id 또는 k_play_sessions.id 등 여러 테이블을 가리킬 수 있어 FK 제약 없음
    feature           TEXT NOT NULL CHECK (feature IN (
                        'auth','home','mission','freechat','play','daily_report',
                        'weekly_report','monthly_report','conversation_topic',
                        'child_management','guardian_settings','subscription'
                      )),
    route             TEXT,
    conversation_mode TEXT CHECK (conversation_mode IS NULL OR conversation_mode IN ('A','B','C','D','E','F')),
    play_type         TEXT CHECK (play_type IS NULL OR play_type IN ('comic_book','quiz','hairstyle','mbti')),
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_seconds  INTEGER,
    environment       TEXT NOT NULL CHECK (environment IN ('dev','prod')),
    app_version       TEXT,
    is_test_account   BOOLEAN NOT NULL DEFAULT false,
    properties        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS behavior_events_occurred_at_idx ON public.behavior_events (occurred_at);
CREATE INDEX IF NOT EXISTS behavior_events_family_id_occurred_at_idx ON public.behavior_events (family_id, occurred_at);
CREATE INDEX IF NOT EXISTS behavior_events_child_id_occurred_at_idx ON public.behavior_events (child_id, occurred_at);
CREATE INDEX IF NOT EXISTS behavior_events_actor_type_event_name_occurred_at_idx ON public.behavior_events (actor_type, event_name, occurred_at);
CREATE INDEX IF NOT EXISTS behavior_events_feature_occurred_at_idx ON public.behavior_events (feature, occurred_at);

-- RLS: 서버(service_role) 전용 (anon/authenticated 거부)
ALTER TABLE public.behavior_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.behavior_events;
CREATE POLICY "service_role_all"
    ON public.behavior_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
