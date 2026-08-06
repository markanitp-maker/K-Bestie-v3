-- 형진님 2026-08-04 지시: 미션 완료 이벤트 집계를 애플리케이션 코드의 여러 호출 지점
-- (V1 answer.ts / V2 answer-lean.ts / 테스트미션 등)에 각각 의존하지 말고, mission_progress
-- 가 실제로 COMPLETED 상태로 전이하는 단 하나의 지점(DB 트랜잭션)에서 무조건 호출되도록
-- 중앙화한다. 김서현 사례(V1 엔진 경로로 완료했으나 이벤트 미반영) 실측 확인 후 조치.
--
-- record_mission_event_completion() 자체가 이미 (event_id, mission_session_id) 기준
-- 멱등이므로, 기존 애플리케이션 레이어의 recordMissionOnboardingCompletion() 호출과
-- 이 트리거가 동시에 남아있어도 중복 집계되지 않는다(안전한 이중 방어로 유지).
--
-- 주의: environment 값은 이 프로젝트(mkrsaaedxqrcrktapaus = Dev)에 고정 배포하는
-- 버전이라 'development'로 하드코딩한다. Production(fetvnhhjicndmxvhrffk)에는 값만
-- 'production'으로 바꾼 동일 함수를 별도 적용한다(물리적으로 분리된 DB라 안전).
CREATE OR REPLACE FUNCTION public.trg_mission_progress_record_event_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND (OLD.status IS DISTINCT FROM 'COMPLETED') THEN
    PERFORM public.record_mission_event_completion(
      NEW.child_id,
      'development',
      NEW.session_id,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mission_progress_event_completion ON mission_progress;
CREATE TRIGGER trg_mission_progress_event_completion
  AFTER UPDATE ON mission_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_mission_progress_record_event_completion();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_mission_progress_event_completion ON mission_progress;
-- DROP FUNCTION IF EXISTS public.trg_mission_progress_record_event_completion();
