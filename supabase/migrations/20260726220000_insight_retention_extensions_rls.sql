-- insight_retention_extensions 테이블 RLS 활성화 및 접근 권한 제한
-- 이전에 RLS가 누락되어 모든 사용자가 익명/인증 토큰으로 제한 없이 접근할 수 있었던 심각한 보안 결함을 수정합니다.

-- 1. RLS 활성화
ALTER TABLE public.insight_retention_extensions ENABLE ROW LEVEL SECURITY;

-- 2. SELECT 정책: service_role 이거나, 요청한 사용자가 해당 family_id의 부모(owner_parent, parent)인 경우만 허용
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

-- 3. INSERT 정책: 일반 사용자의 직접 쓰기 금지, service_role (또는 security definer rpc)만 허용
CREATE POLICY "insight_retention_extensions_insert"
  ON public.insight_retention_extensions FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
  );

-- 4. UPDATE 정책: 일반 사용자의 직접 수정 금지, service_role 만 허용
CREATE POLICY "insight_retention_extensions_update"
  ON public.insight_retention_extensions FOR UPDATE
  USING (
    auth.role() = 'service_role'
  )
  WITH CHECK (
    auth.role() = 'service_role'
  );

-- 5. DELETE 정책: 일반 사용자의 직접 삭제 금지, service_role 만 허용
CREATE POLICY "insight_retention_extensions_delete"
  ON public.insight_retention_extensions FOR DELETE
  USING (
    auth.role() = 'service_role'
  );
