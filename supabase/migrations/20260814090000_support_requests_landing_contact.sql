-- 027: 비로그인 랜딩 문의 접수의 회신용 이메일을 기존 CS 원장에 보관한다.
-- 기존 support_requests 및 RLS는 유지하고 service-role API만 익명 insert를 수행한다.

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN public.support_requests.contact_email IS
  '비로그인 랜딩 문의 접수 시 회신용 연락처 이메일 주소';
