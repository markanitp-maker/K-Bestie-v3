-- 20260802201400_feedback_request_attachments.sql이 GRANT ALL을 빠뜨렸음을
-- 뒤늦게 발견(첨부 라우트가 git에 커밋된 적 없어 지금까지 배포되지 않았고, 그
-- 정적 리뷰 과정에서 함께 드러남). 프로젝트 규약(Supabase 테이블은 anon/
-- authenticated에 GRANT ALL)에 맞춰 보강한다. RLS 정책이 실제 접근을 이미
-- service_role로 제한하므로 이 GRANT는 정책 위에 추가되는 형식적 권한 부여다.
GRANT ALL ON public.feedback_request_attachments TO anon, authenticated;
