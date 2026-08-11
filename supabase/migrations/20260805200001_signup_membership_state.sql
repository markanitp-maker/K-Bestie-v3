-- REQUEST-AUTH-SIGNUP-AUTOLOGIN: 회원가입/자동로그인 정상화
--
-- 1) parents.account_status에 SUSPENDED(관리자 이용정지) 추가 — 기존 탈퇴 상태
--    (WITHDRAWN_PENDING/RESTORE_REQUESTED/PURGED)와는 별개 개념. 기존 값은 전혀
--    건드리지 않고 허용값만 확장한다.
-- 2) parents.phone_number 추가 — 회원가입 2단계(보호자 기본정보)에서 수집. NOTE: 이번
--    변경에는 실제 OTP 발송/검증 연동이 없다(프로젝트에 SMS/OTP 벤더가 아직 연동되어
--    있지 않음) — 형식 검증만 수행하고 저장한다. 실제 인증 연동은 별도 대표님 결정 필요
--    (외부 벤더 선정) 사항으로 최종 보고에 명시한다.
-- 3) signup_consents 테이블 신규 — 지금까지 회원가입 단계에서 필수 동의(서비스 이용약관/
--    보호자 개인정보/아이 개인정보/만14세미만 법정대리인/법정대리인 확인) 및 선택 동의
--    (마케팅/이벤트)를 감사 가능한 방식으로 기록할 곳이 전혀 없었다(child_profiles의
--    guardian_consent 계열 컬럼은 "아이 등록" 동의 1건만 기록 — 부모 자신의 이용약관
--    동의는 어디에도 저장되지 않고 있었음).
--    주의: 이 테이블은 회원가입 상태 판정(멤버십 스테이트머신)의 게이트로 사용하지 않는다
--    — 기존 실사용자는 이 테이블에 아무 행도 없으므로, 존재 여부로 게이트를 걸면 기존
--    활성 보호자가 전부 "회원가입 미완료"로 오분류되어 로그인 시 회원가입 화면으로
--    튕겨나가는 회귀가 발생한다(요청서 §9, §13.3에서 명시적으로 금지). 멤버십 상태는
--    family_members/child_profiles의 구조적 완결성(가족+아이 존재)만으로 판정하고,
--    이 테이블은 신규 가입 마법사가 강제로 채우는 감사 기록 용도로만 쓴다.

-- 원안은 AUTHENTICATED_INCOMPLETE/ONBOARDING(lib/auth/requireActiveAccount.ts,
-- lib/auth/membershipState.ts가 실제 사용하는 회원가입 진행 중 상태)을 누락해
-- Dev 실데이터(가입 진행 중 계정 6건)에서 CHECK 위반으로 실패했다 — 허용값에 추가.
ALTER TABLE parents DROP CONSTRAINT IF EXISTS parents_account_status_check;
ALTER TABLE parents ADD CONSTRAINT parents_account_status_check
  CHECK (account_status IN ('ACTIVE','WITHDRAWN_PENDING','RESTORE_REQUESTED','RESTORED','PURGED','SUSPENDED','AUTHENTICATED_INCOMPLETE','ONBOARDING'));

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

CREATE TABLE IF NOT EXISTS signup_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'service_terms', 'parent_pii', 'child_pii', 'guardian_u14', 'guardian_authority',
    'marketing', 'event_notice'
  )),
  document_version TEXT NOT NULL,
  agreed BOOLEAN NOT NULL,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  auth_method TEXT,
  withdrawn_at TIMESTAMPTZ,
  is_reconsent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_consents_user_id_idx ON signup_consents(user_id);
CREATE INDEX IF NOT EXISTS signup_consents_user_type_idx ON signup_consents(user_id, consent_type);

ALTER TABLE signup_consents ENABLE ROW LEVEL SECURITY;

-- 프로젝트 컨벤션: anon/authenticated에 GRANT ALL 후 RLS 정책으로 실제 행 접근을 제한한다
-- (CLAUDE.md §5 체크리스트, docs/conventions.md "데이터접근" 절 참고).
GRANT ALL ON signup_consents TO anon, authenticated;

DROP POLICY IF EXISTS "signup_consents_select_own" ON signup_consents;
CREATE POLICY "signup_consents_select_own"
  ON signup_consents FOR SELECT
  USING (user_id = auth.uid());

-- INSERT/UPDATE는 서버(Route Handler, service_role)에서만 수행한다 — 클라이언트가 직접
-- 동의 기록을 쓰지 못하도록 별도 authenticated INSERT/UPDATE 정책을 만들지 않는다
-- (service_role은 RLS를 우회하므로 정책 없이도 서버 라우트에서 정상 동작).
