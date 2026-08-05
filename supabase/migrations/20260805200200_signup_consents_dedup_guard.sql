-- REQUEST-AUTH-SIGNUP-AUTOLOGIN — claude-review 정적 리뷰(2026-08-05) 지적사항 반영.
-- signup_consents에 (user_id, consent_type, document_version) 유니크 제약이 없어
-- 이중 클릭/네트워크 재시도로 거의 동시에 두 번 POST되면 동의 행이 중복 생성될 수
-- 있었다(§6/§15 "가입 재시도에도... 동의 데이터 중복 없음" 요구사항 위반 가능성).
-- withdrawn_at이 NULL인 "활성" 동의 행에 대해서만 유일성을 강제한다 — 철회 후 재동의
-- 이력은 여러 행으로 남아야 하므로 부분 인덱스로 제한한다.
CREATE UNIQUE INDEX IF NOT EXISTS signup_consents_active_unique
  ON signup_consents (user_id, consent_type, document_version)
  WHERE withdrawn_at IS NULL;
