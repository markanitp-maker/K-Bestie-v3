-- 20260737000000_play_complete_behavior_event_trigger.sql의 Production 전용 변형.
-- 원본 파일 자체가 명시: "Production 반영 시에는 이 파일을 직접 적용하지 마시고,
-- environment='prod'로 변경한 별도의 마이그레이션 파일을 승인 후 생성하여 적용해야
-- 한다." 대표님 승인(2026-07-28, 베타 Production 전체 스키마 반영 지시) 하에 생성.
-- Dev는 원본 파일(environment='dev')을 그대로 유지, 이 파일은 Production에만 적용한다.

CREATE OR REPLACE FUNCTION public.log_play_complete_behavior_event()
RETURNS TRIGGER AS $$
DECLARE
    v_family_id UUID;
    v_is_test_account BOOLEAN;
BEGIN
    BEGIN
        SELECT family_id, is_test_account
        INTO v_family_id, v_is_test_account
        FROM public.child_profiles
        WHERE id = NEW.child_id;

        INSERT INTO public.behavior_events (
            event_name,
            actor_type,
            actor_id,
            family_id,
            child_id,
            session_id,
            feature,
            play_type,
            occurred_at,
            environment,
            is_test_account,
            properties
        ) VALUES (
            'play_complete',
            'child',
            NULL,
            v_family_id,
            NEW.child_id,
            NEW.id,
            'play',
            NEW.play_type,
            COALESCE(NEW.completed_at, now()),
            'prod',
            COALESCE(v_is_test_account, false),
            '{}'::jsonb
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to log play_complete behavior event: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_play_complete_behavior_event ON public.k_play_sessions;
CREATE TRIGGER trigger_log_play_complete_behavior_event
    AFTER UPDATE ON public.k_play_sessions
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM 'completed' AND NEW.status = 'completed')
    EXECUTE FUNCTION public.log_play_complete_behavior_event();
