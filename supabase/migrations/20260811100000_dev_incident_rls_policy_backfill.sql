-- 2026-08-11 Dev 데이터 유실 사고 후속 조치: Dev DB에 누락된 RLS 정책 18개 백필.
-- Production과 Dev의 pg_policies를 직접 비교해 발견함 — Production에는 존재하지만
-- Dev에는 없는 정책들로, 테이블/함수/GRANT는 정상인데 RLS 정책만 빠져 있어
-- "화면은 뜨지만 데이터 접근은 전부 막힘" 증상(모든 게 에러)을 유발한 것으로 판단된다.
-- 각 정책의 정의는 Production에 실제 적용된 최신 버전(해당 원본 마이그레이션 파일의
-- 최종 버전)을 그대로 옮긴 것이며, 새 로직을 추가하지 않는다. Dev 전용 백필이므로
-- Production에는 적용하지 않는다(이미 존재함).
-- 순수 추가(CREATE POLICY)이며 DROP TABLE/TRUNCATE/DELETE 등 파괴적 문장 없음.

-- ── account_management_audit_log ──────────────────────────────────
DROP POLICY IF EXISTS "account_mgmt_audit_owner_select" ON account_management_audit_log;
CREATE POLICY "account_mgmt_audit_owner_select"
  ON account_management_audit_log FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = account_management_audit_log.family_id
        AND fm.user_id = auth.uid()
        AND fm.role = 'owner_parent'
    )
  );

-- ── family_join_requests (20260612100000 최종본) ──────────────────
DROP POLICY IF EXISTS "fjr_select" ON family_join_requests;
CREATE POLICY "fjr_select"
  ON family_join_requests FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR requester_user_id = auth.uid()
    OR target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = family_join_requests.family_id
        AND fm.user_id = auth.uid()
        AND fm.role = 'owner_parent'
    )
  );

-- ── gold_key_ledger / gold_key_consumptions / k_play_sessions (20260718100000) ──
DROP POLICY IF EXISTS "gold_key_ledger_select_parent_only" ON gold_key_ledger;
CREATE POLICY "gold_key_ledger_select_parent_only"
  ON gold_key_ledger FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_ledger.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

DROP POLICY IF EXISTS "gold_key_consumptions_select_parent_only" ON gold_key_consumptions;
CREATE POLICY "gold_key_consumptions_select_parent_only"
  ON gold_key_consumptions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_consumptions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

DROP POLICY IF EXISTS "k_play_sessions_select_parent_only" ON k_play_sessions;
CREATE POLICY "k_play_sessions_select_parent_only"
  ON k_play_sessions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = k_play_sessions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── gold_key_reservations (20260725300000) ────────────────────────
DROP POLICY IF EXISTS "gold_key_reservations_select_parent_only" ON gold_key_reservations;
CREATE POLICY "gold_key_reservations_select_parent_only"
  ON gold_key_reservations FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_reservations.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── insight_extension_purchases (20260726200000) ──────────────────
DROP POLICY IF EXISTS "insight_extension_purchases_select" ON public.insight_extension_purchases;
CREATE POLICY "insight_extension_purchases_select"
  ON public.insight_extension_purchases FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = insight_extension_purchases.family_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── insight_retention_extensions (20260726220000) ─────────────────
DROP POLICY IF EXISTS "insight_retention_extensions_select" ON public.insight_retention_extensions;
CREATE POLICY "insight_retention_extensions_select"
  ON public.insight_retention_extensions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = insight_retention_extensions.family_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── mbti_completion_events (20260723150000) ───────────────────────
DROP POLICY IF EXISTS "mbti_completion_events_select_parent_only" ON mbti_completion_events;
CREATE POLICY "mbti_completion_events_select_parent_only"
  ON mbti_completion_events FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = mbti_completion_events.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── member_accounts (20260611100000) — 로그인/계정 발급에 직결 ────
DROP POLICY IF EXISTS "member_accounts_select" ON member_accounts;
CREATE POLICY "member_accounts_select"
  ON member_accounts FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = member_accounts.family_id
        AND fm.user_id   = auth.uid()
        AND fm.role      = 'owner_parent'
    )
  );

DROP POLICY IF EXISTS "member_accounts_insert" ON member_accounts;
CREATE POLICY "member_accounts_insert"
  ON member_accounts FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM family_members fm
        WHERE fm.family_id = member_accounts.family_id
          AND fm.user_id   = auth.uid()
          AND fm.role      = 'owner_parent'
      )
    )
  );

DROP POLICY IF EXISTS "member_accounts_update" ON member_accounts;
CREATE POLICY "member_accounts_update"
  ON member_accounts FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = member_accounts.family_id
        AND fm.user_id   = auth.uid()
        AND fm.role      = 'owner_parent'
    )
  );

-- ── mission_question_history / mission_progress (20260717150000 최종본) ──
DROP POLICY IF EXISTS "parent_read_mqh" ON mission_question_history;
CREATE POLICY "parent_read_mqh"
  ON mission_question_history FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = mission_question_history.child_id
        AND fm.user_id = auth.uid()
        AND (
          fm.role IN ('owner_parent', 'parent')
          OR (fm.role = 'child' AND cp.member_id = fm.id)
        )
    )
  );

DROP POLICY IF EXISTS "parent_read_mission_progress" ON mission_progress;
CREATE POLICY "parent_read_mission_progress"
  ON mission_progress FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM chat_sessions cs
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cs.id = mission_progress.session_id
        AND fm.user_id = auth.uid()
        AND (
          fm.role IN ('owner_parent', 'parent')
          OR (fm.role = 'child' AND cp.member_id = fm.id)
        )
    )
  );

-- ── parent_question_quota (20260725200000) ────────────────────────
DROP POLICY IF EXISTS "parent_question_quota_access" ON parent_question_quota;
CREATE POLICY "parent_question_quota_access"
  ON parent_question_quota FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_question_quota.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_question_quota.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── play_bug_reports / play_refund_notifications / play_free_trial_coupons (20260739000000) ──
DROP POLICY IF EXISTS "play_bug_reports_select" ON play_bug_reports;
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

DROP POLICY IF EXISTS "play_refund_notifications_select" ON play_refund_notifications;
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

DROP POLICY IF EXISTS "play_free_trial_coupons_select" ON play_free_trial_coupons;
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
