-- parent_questions 테이블에 K-Chat(폐쇄형 RAG) 기능에서 사용할 "부모 원 질문"과 "보호자 식별자" 컬럼 추가
--
-- 025 agy 초안은 여기에 이어서 parent_questions_select_policy/insert_policy를
-- CREATE POLICY로 신규 추가했으나, 이 테이블에는 이미 동일한 로직(service_role
-- 우회 OR family_members+child_profiles 조인으로 owner_parent/parent 권한 확인)의
-- parent_questions_access 정책(ALL 커맨드)이 존재해 완전히 중복이었다(리뷰 중 발견,
-- 실행 전 제거 - Postgres RLS는 같은 permissive 정책을 OR로 합치므로 동작 자체는
-- 안 깨지지만 불필요한 중복 정책이라 추가하지 않는다).
ALTER TABLE parent_questions
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_question_text TEXT;
