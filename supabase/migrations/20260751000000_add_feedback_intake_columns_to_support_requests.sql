-- Additive migration for support_requests to support feedback intake

ALTER TABLE support_requests ADD COLUMN request_number TEXT;
ALTER TABLE support_requests ADD COLUMN submitter_role TEXT;
ALTER TABLE support_requests ADD COLUMN guardian_id UUID;
ALTER TABLE support_requests ADD COLUMN app_surface TEXT;
ALTER TABLE support_requests ADD COLUMN current_route TEXT;
ALTER TABLE support_requests ADD COLUMN app_version TEXT;
ALTER TABLE support_requests ADD COLUMN environment TEXT;
ALTER TABLE support_requests ADD COLUMN device_info JSONB;
ALTER TABLE support_requests ADD COLUMN idempotency_key TEXT;

-- create an index for request_number for faster search in admin
CREATE INDEX idx_support_requests_request_number ON support_requests(request_number);

-- 중복 제출 방지: 클라이언트가 모달을 열 때 1회 생성해 같은 폼 제출 시도 내내 재사용하는
-- idempotency_key에 유니크 제약을 걸어, count-then-insert 방식의 경합 구간 없이 DB
-- 레벨에서 확실하게 중복을 막는다. NULL은 유니크 제약에서 서로 다른 값으로 취급되므로
-- 과거(이 컬럼 도입 전) 삽입된 행이나 이 값을 못 받은 경로에는 영향 없다.
CREATE UNIQUE INDEX idx_support_requests_idempotency_key
  ON support_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;
