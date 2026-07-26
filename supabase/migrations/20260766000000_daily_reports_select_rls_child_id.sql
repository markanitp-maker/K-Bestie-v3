-- requests/017-report-check.md 후속 — CRITICAL 수정 (codex 리뷰 지적).
-- 개발 서버(mkrsaaedxqrcrktapaus) 전용 — Production에는 별도 승인 없이 적용하지 않는다.
--
-- 20260765000000이 daily_reports.session_id를 nullable로 완화하고 child_id를
-- 추가했지만, 기존 daily_reports_select RLS 정책은 여전히
-- "session_id → chat_sessions → child_profiles → family_members"로 접근 권한을
-- 판정하고 있었다. 신규 생성 리포트(child_id+business_date로 통합 생성, session_id
-- NULL)는 이 EXISTS 조건이 session_id=NULL과 항상 불일치해 절대 매칭되지 않는다 —
-- 즉 부모의 실제 인증 클라이언트(RLS 적용 대상)로는 새로 생성된 리포트가 하나도
-- 조회되지 않는다(애플리케이션 레벨 requireChildAccess는 통과해도 RLS가 막음).
-- daily_reports.child_id를 직접 쓰도록 정책을 재작성한다(세션 조인 제거).

DROP POLICY IF EXISTS "daily_reports_select" ON public.daily_reports;

CREATE POLICY "daily_reports_select"
  ON public.daily_reports FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = daily_reports.child_id
        AND fm.user_id = auth.uid()
        AND fm.role = ANY (ARRAY['owner_parent', 'parent'])
    )
  );
