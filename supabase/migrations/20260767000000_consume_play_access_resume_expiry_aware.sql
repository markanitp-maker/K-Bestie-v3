-- reserve_gold_keys_for_play(20260762000000)와 동일한 기준을 consume_play_access에도
-- 적용한다. consume_play_access는 reserve_gold_keys_for_play를 내부에서 호출하긴
-- 하지만, 그 앞에 자기 자신의 "이미 진행중" 조기 반환 체크(status='in_progress'만 보고
-- resume_expires_at은 확인하지 않음)가 따로 있어 reserve_gold_keys_for_play의 수정이
-- 이 경로까지는 닿지 않았다(퀴즈 /api/quiz/start-handoff, /api/play/consume 등 이 RPC를
-- 쓰는 모든 놀이에 동일한 클래스의 버그가 남아있었다).
--
-- 수정: 이어하기 기간이 남은 세션만 already_in_progress로 조기 반환하고, 기간이 지난
-- 세션은 reserve_gold_keys_for_play와 동일하게 같은 트랜잭션 안에서 'expired'로 전환
-- (물리 삭제 없음)하고 미확정(reserved) 예약만 restore(confirm된 예약은 환급 안 함)한
-- 뒤, 세션이 없었던 것처럼 아래 정상 흐름(쿠폰 확인 → reserve_gold_keys_for_play →
-- start_new_play_session)을 그대로 이어간다. 쿠폰/예약/세션 생성 로직 자체는 건드리지
-- 않는다.

CREATE OR REPLACE FUNCTION public.consume_play_access(
    p_child_id UUID,
    p_play_type TEXT,
    p_idempotency_key TEXT
) RETURNS TABLE (
    session_id UUID,
    access_type TEXT,
    golden_key_charged BOOLEAN,
    remaining_golden_keys INT,
    resume_expires_at TIMESTAMPTZ,
    reason TEXT
) AS $$
DECLARE
    v_session_id UUID;
    v_resume_expires_at TIMESTAMPTZ;
    v_coupon_id UUID;
    v_coupon_used_by_session_id UUID;
    v_coupon_used_by_idem TEXT;
    v_keys_cost INT;
    v_reservation_id UUID;
    v_reserve_reason TEXT;
    v_start_reason TEXT;
    v_remaining_keys INT;
    v_stale_reservation_id UUID;
BEGIN
    IF p_child_id IS NULL OR p_play_type IS NULL OR p_idempotency_key IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, false, 0, NULL::TIMESTAMPTZ, 'invalid_input'::TEXT;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

    SELECT kps.id, kps.resume_expires_at INTO v_session_id, v_resume_expires_at
    FROM k_play_sessions kps
    WHERE kps.child_id = p_child_id AND kps.play_type = p_play_type AND kps.status = 'in_progress'
    LIMIT 1
    FOR UPDATE;

    IF v_session_id IS NOT NULL THEN
        IF v_resume_expires_at IS NULL OR v_resume_expires_at > now() THEN
            -- 이어하기 기간이 남은 실제 진행 세션 -> 기존과 동일하게 already_in_progress.
            SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
            RETURN QUERY SELECT v_session_id, 'resume'::TEXT, false, v_remaining_keys, v_resume_expires_at, 'already_in_progress'::TEXT;
            RETURN;
        ELSE
            -- 이어하기 기간이 지났지만 status는 아직 in_progress -> reserve_gold_keys_for_play와
            -- 동일 기준으로 정리(미확정 예약만 restore, confirm된 예약은 환급 안 함)한 뒤,
            -- 세션이 없었던 것처럼 아래 정상 흐름을 계속한다.
            FOR v_stale_reservation_id IN
                SELECT id FROM gold_key_reservations
                WHERE child_id = p_child_id AND play_type = p_play_type AND status = 'reserved'
                FOR UPDATE
            LOOP
                PERFORM public.restore_gold_key_reservation(v_stale_reservation_id);
            END LOOP;

            UPDATE k_play_sessions
            SET status = 'expired', updated_at = now()
            WHERE id = v_session_id;

            v_session_id := NULL;
            v_resume_expires_at := NULL;
        END IF;
    END IF;

    IF p_play_type IN ('mbti') THEN
        SELECT pftc.used_by_session_id, pftc.used_by_idempotency_key INTO v_coupon_used_by_session_id, v_coupon_used_by_idem
        FROM play_free_trial_coupons pftc
        WHERE pftc.child_id = p_child_id AND pftc.play_type = p_play_type
        FOR UPDATE;

        IF FOUND THEN
            IF v_coupon_used_by_idem = p_idempotency_key THEN
                SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
                SELECT kps.resume_expires_at INTO v_resume_expires_at FROM k_play_sessions kps WHERE kps.id = v_coupon_used_by_session_id;
                RETURN QUERY SELECT v_coupon_used_by_session_id, 'free_trial'::TEXT, false, v_remaining_keys, v_resume_expires_at, 'already_processed'::TEXT;
                RETURN;
            END IF;
        ELSE
            v_keys_cost := CASE
                WHEN p_play_type IN ('comic_book', 'quiz') THEN 2
                WHEN p_play_type IN ('hairstyle', 'mbti') THEN 3
                ELSE 2
            END;

            v_resume_expires_at := now() + interval '6 hours';

            INSERT INTO k_play_sessions (child_id, play_type, keys_cost, status, expires_at, resume_expires_at)
            VALUES (p_child_id, p_play_type, v_keys_cost, 'in_progress', now() + interval '24 hours', v_resume_expires_at)
            RETURNING id INTO v_session_id;

            INSERT INTO play_free_trial_coupons (child_id, play_type, used_by_idempotency_key, used_by_session_id)
            VALUES (p_child_id, p_play_type, p_idempotency_key, v_session_id);

            SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;

            RETURN QUERY SELECT v_session_id, 'free_trial'::TEXT, false, v_remaining_keys, v_resume_expires_at, 'ok'::TEXT;
            RETURN;
        END IF;
    END IF;

    v_keys_cost := CASE
        WHEN p_play_type IN ('comic_book', 'quiz') THEN 2
        WHEN p_play_type IN ('hairstyle', 'mbti') THEN 3
        ELSE 2
    END;

    SELECT rgp.reservation_id, rgp.reason INTO v_reservation_id, v_reserve_reason
    FROM reserve_gold_keys_for_play(p_child_id, p_play_type, v_keys_cost, false) AS rgp;

    IF v_reservation_id IS NULL THEN
        SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, false, v_remaining_keys, NULL::TIMESTAMPTZ, v_reserve_reason;
        RETURN;
    END IF;

    BEGIN
        SELECT snps.session_id, snps.reason INTO v_session_id, v_start_reason
        FROM start_new_play_session(p_child_id, p_play_type, v_reservation_id) AS snps;
    EXCEPTION WHEN OTHERS THEN
        PERFORM restore_gold_key_reservation(v_reservation_id);
        SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, false, v_remaining_keys, NULL::TIMESTAMPTZ, SQLERRM;
        RETURN;
    END;

    IF v_session_id IS NULL THEN
        PERFORM restore_gold_key_reservation(v_reservation_id);
        SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, false, v_remaining_keys, NULL::TIMESTAMPTZ, COALESCE(v_start_reason, 'start_failed');
        RETURN;
    END IF;

    SELECT kps.resume_expires_at INTO v_resume_expires_at FROM k_play_sessions kps WHERE kps.id = v_session_id;
    SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;

    RETURN QUERY SELECT v_session_id, 'golden_key'::TEXT, true, v_remaining_keys, v_resume_expires_at, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.consume_play_access(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_play_access(UUID, TEXT, TEXT) TO service_role;
