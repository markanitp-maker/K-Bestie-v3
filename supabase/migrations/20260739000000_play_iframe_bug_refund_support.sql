-- Migration for play iframe bug, refund, and support
-- A. play_free_trial_coupons
CREATE TABLE play_free_trial_coupons (
    child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
    play_type TEXT NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_by_idempotency_key TEXT NOT NULL,
    used_by_session_id UUID REFERENCES k_play_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(child_id, play_type)
);

CREATE OR REPLACE FUNCTION public.set_play_free_trial_coupons_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_play_free_trial_coupons_updated_at
  BEFORE UPDATE ON play_free_trial_coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_play_free_trial_coupons_updated_at();

ALTER TABLE play_free_trial_coupons ENABLE ROW LEVEL SECURITY;
GRANT ALL ON play_free_trial_coupons TO anon, authenticated;

CREATE POLICY "play_free_trial_coupons_select"
  ON play_free_trial_coupons FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = play_free_trial_coupons.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "play_free_trial_coupons_write_service_only" ON play_free_trial_coupons FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');


-- B. play_bug_reports
CREATE TABLE play_bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    play_type TEXT NOT NULL,
    play_session_id UUID REFERENCES k_play_sessions(id) ON DELETE SET NULL,
    child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL,
    stage TEXT,
    question_number INT,
    error_message TEXT,
    network_status TEXT,
    db_status TEXT,
    browser TEXT,
    os TEXT,
    app_version TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_note TEXT,
    resolved_at TIMESTAMPTZ,
    manual_refund_done BOOLEAN DEFAULT false,
    manual_refund_quantity INT,
    manual_refund_by UUID,
    manual_refund_ledger_ref UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_play_bug_reports_type_status_created ON play_bug_reports (play_type, status, created_at DESC);
CREATE INDEX idx_play_bug_reports_child ON play_bug_reports (child_id);
CREATE INDEX idx_play_bug_reports_session ON play_bug_reports (play_session_id);

CREATE OR REPLACE FUNCTION public.set_play_bug_reports_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_play_bug_reports_updated_at
  BEFORE UPDATE ON play_bug_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_play_bug_reports_updated_at();

ALTER TABLE play_bug_reports ENABLE ROW LEVEL SECURITY;
GRANT ALL ON play_bug_reports TO anon, authenticated;

CREATE POLICY "play_bug_reports_select"
  ON play_bug_reports FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = play_bug_reports.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "play_bug_reports_write_service_only" ON play_bug_reports FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');


-- C. play_refund_notifications
CREATE TABLE play_refund_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
    play_session_id UUID REFERENCES k_play_sessions(id) ON DELETE SET NULL,
    refunded_quantity INT NOT NULL,
    reason TEXT,
    shown_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_play_refund_notifications_unshown ON play_refund_notifications (child_id) WHERE shown_at IS NULL;

ALTER TABLE play_refund_notifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON play_refund_notifications TO anon, authenticated;

CREATE POLICY "play_refund_notifications_select"
  ON play_refund_notifications FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = play_refund_notifications.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "play_refund_notifications_write_service_only" ON play_refund_notifications FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');


-- D. support_requests
CREATE TABLE support_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    child_id UUID REFERENCES child_profiles(id) ON DELETE CASCADE,
    category TEXT CHECK (category IN ('technical', 'feature', 'voc', 'bug')),
    play_type TEXT,
    play_session_id UUID REFERENCES k_play_sessions(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.set_support_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_requests_updated_at
  BEFORE UPDATE ON support_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_support_requests_updated_at();

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON support_requests TO anon, authenticated;

CREATE POLICY "support_requests_select"
  ON support_requests FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR user_id = auth.uid()
  );

-- 모든 INSERT/UPDATE는 검증을 거친 service-role 라우트(/api/support)로만 수행한다.
-- authenticated 직접 INSERT를 허용하면 타 가족 child_id/play_session_id를 위조 연결할 수 있어(정책은 user_id만 검사) 금지한다.
CREATE POLICY "support_requests_write_service_only" ON support_requests FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');

-- E. consume_play_access RPC
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
BEGIN
    IF p_child_id IS NULL OR p_play_type IS NULL OR p_idempotency_key IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, false, 0, NULL::TIMESTAMPTZ, 'invalid_input'::TEXT;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

    SELECT kps.id, kps.resume_expires_at INTO v_session_id, v_resume_expires_at
    FROM k_play_sessions kps
    WHERE kps.child_id = p_child_id AND kps.play_type = p_play_type AND kps.status = 'in_progress'
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
        SELECT COUNT(*)::INT INTO v_remaining_keys FROM gold_key_ledger gkl WHERE gkl.child_id = p_child_id AND gkl.consumed = false AND gkl.expires_at > now() AND gkl.reserved_by_reservation_id IS NULL;
        RETURN QUERY SELECT v_session_id, 'resume'::TEXT, false, v_remaining_keys, v_resume_expires_at, 'already_in_progress'::TEXT;
        RETURN;
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

-- F. refund_play_session RPC
CREATE OR REPLACE FUNCTION public.refund_play_session(p_play_session_id UUID)
RETURNS TABLE (success BOOLEAN, refunded_count INTEGER, header_id UUID, reason TEXT)
AS $$
DECLARE
    v_child_id UUID;
    v_header RECORD;
BEGIN
    SELECT gkc.child_id INTO v_child_id FROM gold_key_consumptions gkc WHERE gkc.play_session_id = p_play_session_id ORDER BY gkc.created_at DESC LIMIT 1;
    IF v_child_id IS NULL THEN
        RETURN QUERY SELECT false, 0, NULL::UUID, 'not_found'::TEXT;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_child_id::text));

    SELECT gkc.id, gkc.status, gkc.consumed_count, gkc.refunded_count INTO v_header FROM gold_key_consumptions gkc WHERE gkc.play_session_id = p_play_session_id ORDER BY gkc.created_at DESC LIMIT 1 FOR UPDATE;

    IF v_header.status = 'refunded' OR (v_header.consumed_count - v_header.refunded_count) <= 0 THEN
        RETURN QUERY SELECT false, 0, v_header.id, 'already_refunded'::TEXT;
        RETURN;
    END IF;

    IF v_header.status = 'insufficient' OR v_header.consumed_count = 0 THEN
        RETURN QUERY SELECT false, 0, v_header.id, 'nothing_to_refund'::TEXT;
        RETURN;
    END IF;

    UPDATE gold_key_ledger gkl
    SET consumed = false, consumed_at = NULL, consumed_by_play_session_id = NULL, reserved_by_reservation_id = NULL
    WHERE gkl.consumed_by_play_session_id = p_play_session_id AND gkl.consumed = true;

    UPDATE gold_key_consumptions gkc
    SET refunded_count = v_header.consumed_count, status = 'refunded', updated_at = now()
    WHERE gkc.id = v_header.id;

    RETURN QUERY SELECT true, (v_header.consumed_count - v_header.refunded_count), v_header.id, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.refund_play_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_play_session(UUID) TO service_role;
