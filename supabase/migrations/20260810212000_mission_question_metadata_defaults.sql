-- claude-review-073-phase2 [단순] S-1: 10개 metadata 컬럼이 DEFAULT 없이 NOT NULL이라
-- scripts/seed-question-bank-v2.ts, scripts/seed-alpha-question-bank.js 등 기존
-- 질문 INSERT 경로가 이 컬럼들을 채우지 않아 전부 실패한다. semantic_group은
-- 가드가 명시적으로 거부하는 'OPEN_CONVERSATION'과 겹치지 않는 별도 sentinel
-- 값('UNCLASSIFIED')을 써서, 새로 들어온 미분류 질문을 나중에 조회로 쉽게 찾아
-- 재분류할 수 있게 한다. semantic_group_format_check(^[A-Z0-9_]+$)와
-- topic_not_blank_check를 모두 만족한다.

ALTER TABLE public.mission_questions
  ALTER COLUMN semantic_group SET DEFAULT 'UNCLASSIFIED',
  ALTER COLUMN cooldown_days SET DEFAULT 3,
  ALTER COLUMN weekday_affinity SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN topic SET DEFAULT 'unclassified',
  ALTER COLUMN conversation_style SET DEFAULT 'open_story',
  ALTER COLUMN fun_type SET DEFAULT 'none',
  ALTER COLUMN memory_usable SET DEFAULT false,
  ALTER COLUMN sensitivity SET DEFAULT 'low',
  ALTER COLUMN answer_mode SET DEFAULT 'open',
  ALTER COLUMN periodicity SET DEFAULT 'flexible';
