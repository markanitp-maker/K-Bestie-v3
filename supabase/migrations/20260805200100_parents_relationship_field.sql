-- REQUEST-AUTH-SIGNUP-AUTOLOGIN §5.2: 보호자 기본정보에 "아이와의 관계" 필드가 필요한데
-- 기존 parents 테이블에 대응 컬럼이 없다(스캔 결과 미확인) — 최소 범위로 추가한다.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS relationship_to_child TEXT,
  ADD COLUMN IF NOT EXISTS legal_guardian_confirmed_at TIMESTAMPTZ;
