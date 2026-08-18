-- 078 후속 교정: school_context_tag 에 CSV 원본의 TRUE/FALSE 문자열이 그대로
-- 들어간 것을 DB 표준값으로 정규화한다.
--
-- 배경: canonical 적용 시 검수 CSV 의 school_context_required 열(TRUE/FALSE)을
-- DB 도메인값(school_required/universal)으로 변환하지 않고 그대로 기록했다.
-- 방학 차단 코드는 'school_required' 만 보므로, TRUE 로 들어간 56건은
-- 학교 전제 질문인데도 방학에 그대로 노출된다.
--
-- 멱등하다. 이미 정규화된 행은 바뀌지 않는다.

UPDATE mission_questions
   SET school_context_tag = 'school_required'
 WHERE school_context_tag = 'TRUE';

UPDATE mission_questions
   SET school_context_tag = 'universal'
 WHERE school_context_tag = 'FALSE';
