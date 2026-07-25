-- 목적: 퀴즈마스터 연동(requests/010) 전용 환불 RPC 신규 추가.
--
-- 배경: 퀴즈마스터는 k_play_sessions를 쓰지 않고 자체 quiz_handoff_tokens/quiz_attempts로
-- 상태를 관리한다. 골드키 소비는 놀이 공용 인프라(consume_play_access)가 아니라
-- lib/goldkey/ledger.ts의 consumeKeys()(=consume_gold_keys, p_play_session_id=NULL)로
-- 이뤄진다. 기존 환불 RPC인 refund_play_session/refund_gold_keys는 둘 다
-- gold_key_ledger.consumed_by_play_session_id로 "이번에 정확히 어떤 개별 키 행이
-- 소비됐는지"를 역추적한 뒤 그 행들만 되돌리는 방식인데, consume_gold_keys를
-- p_play_session_id=NULL로 호출하면 소비된 모든 키 행의 consumed_by_play_session_id가
-- 똑같이 NULL로 찍힌다 - 즉 같은 아이가 세션 없는 소비를 여러 번 했을 경우 "이번
-- 거래가 정확히 어느 키 행을 썼는지" 개별 행 단위로 구분할 방법이 없다(2026-07-25
-- 코드 직접 확인, _blocked.md 010 항목 참고). 기존 두 RPC를 그대로 재사용하면 엉뚱한
-- 다른 소비 건의 키 행을 잘못 되돌릴 위험이 있어 명백히 부적합하다.
--
-- 그래서 개별 키 행을 "되돌리는" 방식이 아니라, gold_key_consumptions 헤더(=
-- reward_transaction_id) 단위로 상태만 확인하고 새 키 1개를 발급하는 방식으로
-- 설계했다 - 어떤 개별 원장 행이 이번 거래의 것인지 추적할 필요 자체가 없어져
-- 위 모호성 문제가 원천적으로 사라진다. 대가로 환불된 키의 만료일은 원래 소비된
-- 키의 잔여 만료일이 아니라 새 7일 만료로 재발급된다(원래보다 짧아지는 경우는
-- 없고, 길어질 수만 있음 - 아이에게 불리하지 않은 방향의 차이).
--
-- gold_key_ledger.reason CHECK에 'quiz_refund' 1개 값만 추가한다(기존 3개 값 유지,
-- MBTI/출석/미션 로직이 조회하는 reason 값과 겹치지 않아 그 로직들에 영향 없음).
-- 기존 refund_play_session/refund_gold_keys RPC는 이 마이그레이션에서 전혀 건드리지
-- 않는다. play_session_id IS NULL 조건으로 대상을 한정해, 실수로 MBTI 등 놀이 세션
-- 기반 소비 건에 이 함수가 호출되더라도 구조적으로 아무 효과가 없게 만든다(격리
-- 이중 보장).
--
-- 010 "데이터 모델 검토"/"보안 검증" 요구사항 반영(2026-07-25 claude-review 지적 후 수정):
-- gold_key_consumptions에 external_attempt_id(quizmaster_attempt_id 저장)/
-- refund_reason/completion_score 3개 컬럼을 추가한다(전부 nullable, MBTI 등 기존
-- 소비 건에는 전부 NULL로 남아 영향 없음). 신규 RPC는 이 값들을 받아 환불 확정과
-- 함께 원자적으로 기록하고, 이미 다른 attempt_id로 기록된 거래에 다른 값이 들어오면
-- (변조/중복 의심) 거부한다.
--
-- 권한: 이 함수는 SECURITY DEFINER이고 유일한 호출자는 이 저장소의
-- app/api/rewards/golden-key/refund/route.ts(서비스 롤 클라이언트만 사용)뿐이다.
-- 같은 도메인의 기존 RPC(consume_gold_keys/refund_gold_keys/refund_play_session 등)는
-- 이 저장소보다 이전부터 anon/authenticated에도 EXECUTE를 허용해 왔지만(기존 관례,
-- 이번 작업 범위 밖이라 그대로 둠), 이 신규 함수는 그 관례를 따르지 않고
-- service_role에만 국한한다 - 유일한 실제 호출자가 이미 서비스 롤만 쓰고 있어
-- 기능상 손실이 없고, 골드키를 직접 발급하는 민감한 동작이라 불필요한 노출을
-- 만들지 않는 것이 낫다고 판단했다(첫 버전에서 anon/authenticated에도 GRANT했던
-- 실수를 여기서 REVOKE로 되돌린다).
--
-- Dev 전용 적용 (Production 미적용).

ALTER TABLE gold_key_ledger DROP CONSTRAINT IF EXISTS gold_key_ledger_reason_check;
ALTER TABLE gold_key_ledger ADD CONSTRAINT gold_key_ledger_reason_check
  CHECK (reason IN ('attendance', 'mission', 'admin_adjustment', 'quiz_refund'));

ALTER TABLE gold_key_consumptions ADD COLUMN IF NOT EXISTS external_attempt_id text;
ALTER TABLE gold_key_consumptions ADD COLUMN IF NOT EXISTS refund_reason text;
ALTER TABLE gold_key_consumptions ADD COLUMN IF NOT EXISTS completion_score integer;

-- 첫 버전(1-arg)이 이미 Dev에 적용돼 있을 수 있으므로, 시그니처를 바꾸며 명시적으로
-- 먼저 제거한다(같은 이름의 오버로드로 남아 예전 GRANT까지 함께 남는 사고를 방지).
DROP FUNCTION IF EXISTS public.refund_gold_keys_by_consumption_id(uuid);

CREATE OR REPLACE FUNCTION public.refund_gold_keys_by_consumption_id(
  p_consumption_id uuid,
  p_external_attempt_id text,
  p_refund_reason text
)
RETURNS TABLE(success boolean, refunded_count integer, header_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_child_id UUID;
    v_header RECORD;
    v_to_refund INTEGER;
    v_i INTEGER;
BEGIN
    SELECT gkc.child_id INTO v_child_id
    FROM gold_key_consumptions gkc
    WHERE gkc.id = p_consumption_id
      AND gkc.play_session_id IS NULL;

    IF v_child_id IS NULL THEN
        RETURN QUERY SELECT false, 0, NULL::UUID, 'not_found'::TEXT;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_child_id::text));

    SELECT gkc.id, gkc.status, gkc.consumed_count, gkc.refunded_count, gkc.external_attempt_id
    INTO v_header
    FROM gold_key_consumptions gkc
    WHERE gkc.id = p_consumption_id
      AND gkc.play_session_id IS NULL
    FOR UPDATE;

    -- 010 "보안 검증": quizmaster_attempt_id 변조/중복 의심 - 이미 다른 attempt_id로
    -- 기록된 거래에 다른 값이 들어오면 상태와 무관하게 즉시 거부한다.
    IF v_header.external_attempt_id IS NOT NULL AND v_header.external_attempt_id <> p_external_attempt_id THEN
        RETURN QUERY SELECT false, 0, v_header.id, 'attempt_id_mismatch'::TEXT;
        RETURN;
    END IF;

    IF v_header.status = 'refunded' OR (v_header.consumed_count - v_header.refunded_count) <= 0 THEN
        RETURN QUERY SELECT false, 0, v_header.id, 'already_refunded'::TEXT;
        RETURN;
    END IF;

    IF v_header.status = 'insufficient' OR v_header.consumed_count = 0 THEN
        RETURN QUERY SELECT false, 0, v_header.id, 'nothing_to_refund'::TEXT;
        RETURN;
    END IF;

    v_to_refund := v_header.consumed_count - v_header.refunded_count;

    v_i := 0;
    WHILE v_i < v_to_refund LOOP
        INSERT INTO gold_key_ledger (child_id, reason, expires_at)
        VALUES (v_child_id, 'quiz_refund', now() + interval '7 days');
        v_i := v_i + 1;
    END LOOP;

    UPDATE gold_key_consumptions gkc
    SET refunded_count = v_header.consumed_count,
        status = 'refunded',
        external_attempt_id = p_external_attempt_id,
        refund_reason = p_refund_reason,
        updated_at = now()
    WHERE gkc.id = v_header.id;

    RETURN QUERY SELECT true, v_to_refund, v_header.id, 'ok'::TEXT;
END;
$function$;

-- 이 프로젝트의 스키마 기본 권한(ALTER DEFAULT PRIVILEGES)이 새 함수마다 자동으로
-- anon/authenticated/service_role에 EXECUTE를 부여하고 있어(다른 골드키 RPC들도
-- 전부 동일하게 이 세 role을 갖고 있음을 확인했다), PUBLIC만 REVOKE해서는 부족하다 -
-- anon/authenticated에서도 명시적으로 REVOKE해야 실제로 service_role 전용이 된다.
REVOKE ALL ON FUNCTION public.refund_gold_keys_by_consumption_id(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_gold_keys_by_consumption_id(uuid, text, text) TO service_role;
