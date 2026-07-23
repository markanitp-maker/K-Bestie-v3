-- 이 트리거는 케이 놀이("만화책", "퀴즈" 등)의 "완료" 이벤트(play_complete)를 behavior_events에 기록합니다.
-- 케이 놀이 세션의 완료 처리는 이 애플리케이션(Next.js) 외부에 있는 앱에서 k_play_sessions.status를 직접
-- 업데이트하는 방식으로 일어날 수 있으므로, 애플리케이션 계측 코드만으로는 이를 모두 감지하기 어렵습니다.
-- 따라서 k_play_sessions 테이블의 status 컬럼이 'completed'로 변경되는 시점을 DB 트리거로 캡처하여 이벤트를 기록합니다.
--
-- 주의: 이 마이그레이션은 Dev 전용이며, environment = 'dev' 리터럴이 하드코딩되어 있습니다.
-- Production 반영 시에는 이 파일을 직접 적용하지 마시고, environment = 'prod'로 변경한 별도의 마이그레이션 파일을 
-- 승인 후 생성하여 적용해야 합니다.

CREATE OR REPLACE FUNCTION public.log_play_complete_behavior_event()
RETURNS TRIGGER AS $$
DECLARE
    v_family_id UUID;
    v_is_test_account BOOLEAN;
BEGIN
    BEGIN
        -- 관련된 child_profiles에서 family_id와 is_test_account 조회
        SELECT family_id, is_test_account
        INTO v_family_id, v_is_test_account
        FROM public.child_profiles
        WHERE id = NEW.child_id;

        -- behavior_events 기록
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
            NULL, -- child_id가 이미 식별 가능하므로 auth user_id는 생략(NULL)
            v_family_id,
            NEW.child_id,
            NEW.id,
            'play',
            NEW.play_type,
            COALESCE(NEW.completed_at, now()),
            'dev',
            COALESCE(v_is_test_account, false),
            '{}'::jsonb
        );
    EXCEPTION WHEN OTHERS THEN
        -- 로깅이 실패하더라도 실제 k_play_sessions 업데이트 자체가 롤백되지 않도록 예외 처리
        RAISE WARNING 'Failed to log play_complete behavior event: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 혹시 존재할지 모르는 기존 트리거 제거 후 생성
DROP TRIGGER IF EXISTS trigger_log_play_complete_behavior_event ON public.k_play_sessions;
CREATE TRIGGER trigger_log_play_complete_behavior_event
    AFTER UPDATE ON public.k_play_sessions
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM 'completed' AND NEW.status = 'completed')
    EXECUTE FUNCTION public.log_play_complete_behavior_event();
