-- 1순위: 베타 신청 (beta_applications), 문의/건의/버그 (support_requests) 소프트삭제 컬럼 추가

ALTER TABLE public.beta_applications
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_beta_applications_deleted_at 
  ON public.beta_applications(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_support_requests_deleted_at 
  ON public.support_requests(deleted_at) WHERE deleted_at IS NULL;

-- 2순위: 요금제 변경 요청 (plan_change_requests), 아이 승인 요청 (child_approval_requests), 이벤트 지급 처리 이력 (event_reward_fulfillments)
ALTER TABLE public.plan_change_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_plan_change_requests_deleted_at 
  ON public.plan_change_requests(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.child_approval_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_child_approval_requests_deleted_at 
  ON public.child_approval_requests(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.event_reward_fulfillments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_event_reward_fulfillments_deleted_at 
  ON public.event_reward_fulfillments(deleted_at) WHERE deleted_at IS NULL;

-- 계정 복구 요청의 경우 부모 계정 자체를 건드릴 수 없으므로, 숨김 처리를 위한 별도 테이블 생성
CREATE TABLE IF NOT EXISTS public.admin_hidden_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID NOT NULL,
  delete_reason TEXT NOT NULL,
  restored_at TIMESTAMPTZ,
  restored_by UUID,
  permanently_deleted_at TIMESTAMPTZ,
  UNIQUE(resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_hidden_requests_lookup 
  ON public.admin_hidden_requests(resource_type, resource_id) 
  WHERE restored_at IS NULL AND permanently_deleted_at IS NULL;

-- admin_audit_log에 action 제약 조건 업데이트 (SOFT_DELETE, RESTORE 등 추가)
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
-- 제약 조건을 삭제하여 어떤 action이든 들어갈 수 있게 합니다.

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS before_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS after_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

