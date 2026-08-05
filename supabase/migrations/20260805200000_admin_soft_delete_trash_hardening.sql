-- requests/066 관리자 운영 요청 데이터 소프트 삭제 — 휴지통/영구삭제 보강 마이그레이션
--
-- 선행 마이그레이션(20260805120000_admin_soft_delete_infrastructure.sql)은 이미 Dev에
-- 적용돼 있으므로 수정하지 않는다. 이 파일은 그 위에 얹는 forward-only 보강분이다.
--
-- 1) admin_hidden_requests 보안 잠금
--    선행 마이그레이션이 이 테이블을 RLS 없이 만들었고 anon/authenticated에 기본
--    GRANT가 남아 있어(관리자 전용 데이터인데) 익명 키로 읽고 쓸 수 있는 상태다.
--    RLS를 켜고(정책 없음 = 전면 거부) anon/authenticated 권한을 회수한다.
--    service_role은 RLS를 우회하므로 서버 라우트 동작에는 영향이 없다.
-- 2) 휴지통 조회용 부분 인덱스(deleted_at IS NOT NULL) 추가
--    기존 인덱스는 목록 제외용(deleted_at IS NULL)이라 휴지통 조회를 못 탄다.
-- 3) admin_audit_log.admin_user_id NOT NULL 완화
--    30일 자동 영구 삭제는 사람(관리자 세션) 없이 cron이 수행하므로 수행자 uuid가 없다.
--    NULL 허용은 기존 insert를 깨지 않는 완화 방향 변경이다.
--
-- 재실행 안전(idempotent): 전부 IF EXISTS / IF NOT EXISTS / DROP NOT NULL 사용.

-- ---------------------------------------------------------------------------
-- 1) admin_hidden_requests 보안 잠금
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_hidden_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_hidden_requests FROM anon;
REVOKE ALL ON public.admin_hidden_requests FROM authenticated;
GRANT ALL ON public.admin_hidden_requests TO service_role;

-- ---------------------------------------------------------------------------
-- 2) 휴지통 조회용 부분 인덱스
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_beta_applications_trash
  ON public.beta_applications (deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_requests_trash
  ON public.support_requests (deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_change_requests_trash
  ON public.plan_change_requests (deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_child_approval_requests_trash
  ON public.child_approval_requests (deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_reward_fulfillments_trash
  ON public.event_reward_fulfillments (deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) 감사 로그 — cron(무인) 수행자 허용 + 리소스 조회 인덱스
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource
  ON public.admin_audit_log (resource_type, resource_id, created_at DESC);
