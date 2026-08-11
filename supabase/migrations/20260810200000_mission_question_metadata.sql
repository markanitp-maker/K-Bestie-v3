-- 073 Mission v3 Phase 2 — 질문은행을 Dynamic Conversation Library로 승격한다.
-- 기존 질문/식별자/이력은 보존하며 metadata 컬럼 추가와 결정론적 UPDATE만 수행한다.
-- Dev/Production 적용은 정적 리뷰 이후 별도 게이트에서 진행한다.

ALTER TABLE public.mission_questions
  ADD COLUMN IF NOT EXISTS semantic_group TEXT,
  ADD COLUMN IF NOT EXISTS cooldown_days SMALLINT,
  ADD COLUMN IF NOT EXISTS weekday_affinity TEXT[],
  ADD COLUMN IF NOT EXISTS topic TEXT,
  ADD COLUMN IF NOT EXISTS conversation_style TEXT,
  ADD COLUMN IF NOT EXISTS fun_type TEXT,
  ADD COLUMN IF NOT EXISTS memory_usable BOOLEAN,
  ADD COLUMN IF NOT EXISTS sensitivity TEXT,
  ADD COLUMN IF NOT EXISTS answer_mode TEXT,
  ADD COLUMN IF NOT EXISTS periodicity TEXT;

-- 질문 ID가 달라도 같은 의미면 같은 semantic_group을 사용한다. 질문 텍스트의 구체적
-- 의미를 먼저 보고, 마지막에 기존 dashboard area를 안전한 fallback으로 사용한다.
UPDATE public.mission_questions
SET semantic_group = CASE
  WHEN dashboard_area_tag = 'greeting'
    OR question_text ~ '(안녕|누구니|이름|별명|뭐라고 부르면)'
    THEN 'RAPPORT_IDENTITY'
  WHEN question_text ~ '(밥|점심|저녁|먹은|먹었|맛있)' THEN 'MEAL_AND_TASTE'
  WHEN question_text ~ '(배고|졸려|피곤|몸은|몸이|쉬고 싶|잠|쌩쌩|불편했|아픈|많이 뛰|움직였)' THEN 'PHYSICAL_STATE'
  WHEN question_text ~ '(기분|마음 날씨|색깔로|감정|신났|행복|슬펐|화났)' THEN 'MOOD_CHECK'
  WHEN question_text ~ '(상상|만약|마법|초능력|투명인간|된다면)' THEN 'PLAYFUL_IMAGINATION'
  WHEN question_text ~ '(도움받고 싶은 사람|도와줄 사람|편하게 이야기|의지할|믿고 말|보호자)' THEN 'SUPPORT_NETWORK'
  WHEN question_text ~ '(괴롭|따돌|폭력|무서웠|안전|위험)' THEN 'SAFETY_EXPERIENCE'
  WHEN question_text ~ '(서운|속상|억울|불공평|부당|생각이 달랐|다퉜|갈등|답답)' THEN 'FRIEND_CONFLICT'
  WHEN dashboard_area_tag = 'peer_relations'
    AND question_text ~ '(도와|고마|같이|함께|친한|편한 친구|누구랑|친구)'
    THEN 'PEER_CONNECTION'
  WHEN question_text ~ '(잘했|잘하게|해냈|끝까지|뿌듯|칭찬|장점|도전|성장|달라졌)' THEN 'ACHIEVEMENT'
  WHEN dashboard_area_tag = 'study_concerns'
    OR question_text ~ '(공부|숙제|시험|성적|학원.*부담|수업.*어려|배우.*어려)'
    THEN 'LEARNING_AND_STUDY'
  WHEN question_text ~ '(선생님)' THEN 'TEACHER_RELATIONSHIP'
  WHEN dashboard_area_tag = 'school_life' THEN 'SCHOOL_EXPERIENCE'
  WHEN dashboard_area_tag = 'digital_interests'
    AND question_text ~ '(신경 쓰|불편|비교|시간.*보낸 뒤|온라인.*기분)'
    THEN 'DIGITAL_WELLBEING'
  WHEN dashboard_area_tag = 'digital_interests'
    OR question_text ~ '(게임|영상|유튜브|만화|SNS|온라인|폰|태블릿|콘텐츠)'
    THEN 'DIGITAL_CONTENT'
  WHEN dashboard_area_tag = 'future_dreams'
    OR question_text ~ '(커서|되고 싶|꿈|미래|장래|중학교.*기대|해보고 싶)'
    THEN 'FUTURE_HOPE'
  WHEN question_text ~ '(그림|그리|만들|색칠|노래|춤|운동|취미|놀이)' THEN 'HOBBY_AND_CREATION'
  WHEN dashboard_area_tag = 'interests'
    OR question_text ~ '(좋아하는|관심|추천|마음에 드|시간 가는 줄)'
    THEN 'INTEREST_AND_PREFERENCE'
  WHEN question_text ~ '(가족|엄마|아빠|형제|자매|할머니|할아버지)' THEN 'FAMILY_RELATIONSHIP'
  WHEN question_text ~ '(날씨|어디 갔|뭐 했|오늘 하루|기억에 남|말해주고 싶은)' THEN 'DAILY_HIGHLIGHT'
  WHEN dashboard_area_tag = 'recurring_stories' THEN 'DAILY_HIGHLIGHT'
  WHEN dashboard_area_tag = 'daily_general' THEN 'DAILY_LIFE'
  WHEN dashboard_area_tag = 'emotion' THEN 'EMOTIONAL_EXPERIENCE'
  WHEN dashboard_area_tag = 'peer_relations' THEN 'PEER_CONNECTION'
  ELSE 'OPEN_CONVERSATION'
END;

UPDATE public.mission_questions
SET
  periodicity = CASE cycle_type
    WHEN 'onboarding' THEN 'onboarding_once'
    WHEN 'weekly' THEN 'weekly'
    WHEN 'monthly' THEN 'monthly'
    WHEN 'quarterly' THEN 'quarterly'
    ELSE 'flexible'
  END,
  sensitivity = CASE
    WHEN semantic_group IN ('SAFETY_EXPERIENCE', 'SUPPORT_NETWORK')
      OR question_text ~ '(괴롭|따돌|폭력|죽|사라지고|위험|무서웠)' THEN 'high'
    WHEN semantic_group IN ('FRIEND_CONFLICT', 'DIGITAL_WELLBEING')
      OR question_text ~ '(속상|힘들|걱정|서운|억울|부담|외로|불편|말하기 싫)' THEN 'medium'
    ELSE 'low'
  END,
  topic = lower(semantic_group),
  conversation_style = CASE
    WHEN question_text ~ '(없으면 넘어가도|말하기 싫으면|편하면|괜찮으면)' THEN 'permission_first'
    WHEN question_text ~ '(알려줄래|가르쳐|추천)' THEN 'child_as_expert'
    WHEN cycle_type IN ('weekly', 'monthly', 'quarterly')
      OR question_text ~ '(이번 주|이번 달|세 달|예전|전보다)' THEN 'reflective'
    WHEN question_text ~ '(상상|만약|마법|초능력|하나를 골라)' THEN 'imaginative'
    WHEN question_text ~ '(어느 쪽|아니면|,.*어\?|,.*야\?|,.*해\?)' THEN 'choice_based'
    ELSE 'open_story'
  END,
  fun_type = CASE
    WHEN question_text ~ '(상상|만약|마법|초능력)' THEN 'imagination'
    WHEN question_text ~ '(어느 쪽|하나를 골라|아니면)' THEN 'balance_choice'
    WHEN question_text ~ '(추천|알려줄래|가르쳐)' THEN 'teach_k'
    WHEN question_text ~ '(웃|재밌|재미|게임|놀이)' THEN 'playful_story'
    WHEN cycle_type IN ('weekly', 'monthly', 'quarterly') THEN 'reflection'
    ELSE 'none'
  END,
  answer_mode = CASE
    WHEN question_text ~ '(없으면 넘어가도|말하기 싫으면|편하면|괜찮으면)' THEN 'optional_open'
    WHEN question_text ~ '(색깔|날씨로|점수로)' THEN 'metaphor'
    WHEN question_text ~ '(어느 쪽|아니면|,.*어\?|,.*야\?|,.*해\?)' THEN 'choice'
    WHEN question_text ~ '(하나만|한 가지만)' THEN 'short_open'
    ELSE 'open'
  END,
  memory_usable = CASE
    WHEN semantic_group IN (
      'RAPPORT_IDENTITY', 'SUPPORT_NETWORK', 'PEER_CONNECTION',
      'ACHIEVEMENT', 'TEACHER_RELATIONSHIP', 'DIGITAL_CONTENT',
      'FUTURE_HOPE', 'HOBBY_AND_CREATION', 'INTEREST_AND_PREFERENCE',
      'FAMILY_RELATIONSHIP'
    ) THEN true
    WHEN cycle_type IN ('monthly', 'quarterly') THEN true
    ELSE false
  END,
  weekday_affinity = CASE
    WHEN cycle_type IN ('monthly', 'quarterly') THEN ARRAY['sun']::TEXT[]
    WHEN semantic_group IN ('SCHOOL_EXPERIENCE', 'LEARNING_AND_STUDY', 'TEACHER_RELATIONSHIP') THEN ARRAY['mon']::TEXT[]
    WHEN semantic_group IN ('PEER_CONNECTION', 'FRIEND_CONFLICT', 'SUPPORT_NETWORK') THEN ARRAY['tue']::TEXT[]
    WHEN semantic_group IN ('DIGITAL_CONTENT', 'DIGITAL_WELLBEING', 'INTEREST_AND_PREFERENCE') THEN ARRAY['wed']::TEXT[]
    WHEN question_text ~ '(상상|만약|마법|초능력|어느 쪽|하나를 골라|아니면|추천|가르쳐)' THEN ARRAY['thu']::TEXT[]
    WHEN semantic_group = 'ACHIEVEMENT' THEN ARRAY['fri']::TEXT[]
    WHEN semantic_group IN ('HOBBY_AND_CREATION', 'FAMILY_RELATIONSHIP') THEN ARRAY['sat']::TEXT[]
    WHEN cycle_type = 'weekly' OR semantic_group IN ('DAILY_HIGHLIGHT', 'EMOTIONAL_EXPERIENCE') THEN ARRAY['sun']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

UPDATE public.mission_questions
SET cooldown_days = CASE
  WHEN periodicity = 'quarterly' THEN 90
  WHEN periodicity = 'monthly' THEN 30
  WHEN periodicity = 'weekly' THEN 7
  WHEN sensitivity = 'high' THEN 14
  WHEN sensitivity = 'medium' THEN 7
  WHEN semantic_group IN ('INTEREST_AND_PREFERENCE', 'FUTURE_HOPE', 'RAPPORT_IDENTITY') THEN 7
  WHEN semantic_group IN ('MEAL_AND_TASTE', 'PHYSICAL_STATE') THEN 1
  ELSE 3
END;

DO $$
DECLARE
  incomplete_count BIGINT;
BEGIN
  SELECT count(*) INTO incomplete_count
  FROM public.mission_questions
  WHERE semantic_group IS NULL
     OR cooldown_days IS NULL
     OR weekday_affinity IS NULL
     OR topic IS NULL
     OR conversation_style IS NULL
     OR fun_type IS NULL
     OR memory_usable IS NULL
     OR sensitivity IS NULL
     OR answer_mode IS NULL
     OR periodicity IS NULL
     OR semantic_group = 'OPEN_CONVERSATION';

  IF incomplete_count > 0 THEN
    RAISE EXCEPTION 'mission_questions metadata classification incomplete: % rows', incomplete_count;
  END IF;
END $$;

ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_semantic_group_format_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_cooldown_days_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_weekday_affinity_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_topic_not_blank_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_conversation_style_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_fun_type_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_sensitivity_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_answer_mode_check;
ALTER TABLE public.mission_questions DROP CONSTRAINT IF EXISTS mission_questions_periodicity_check;

ALTER TABLE public.mission_questions
  ALTER COLUMN semantic_group SET NOT NULL,
  ALTER COLUMN cooldown_days SET NOT NULL,
  ALTER COLUMN weekday_affinity SET NOT NULL,
  ALTER COLUMN topic SET NOT NULL,
  ALTER COLUMN conversation_style SET NOT NULL,
  ALTER COLUMN fun_type SET NOT NULL,
  ALTER COLUMN memory_usable SET NOT NULL,
  ALTER COLUMN sensitivity SET NOT NULL,
  ALTER COLUMN answer_mode SET NOT NULL,
  ALTER COLUMN periodicity SET NOT NULL,
  ADD CONSTRAINT mission_questions_semantic_group_format_check
    CHECK (semantic_group ~ '^[A-Z0-9_]+$'),
  ADD CONSTRAINT mission_questions_cooldown_days_check CHECK (cooldown_days BETWEEN 0 AND 365),
  ADD CONSTRAINT mission_questions_weekday_affinity_check
    CHECK (weekday_affinity <@ ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::TEXT[]),
  ADD CONSTRAINT mission_questions_topic_not_blank_check CHECK (btrim(topic) <> ''),
  ADD CONSTRAINT mission_questions_conversation_style_check
    CHECK (conversation_style IN ('permission_first', 'child_as_expert', 'reflective', 'imaginative', 'choice_based', 'open_story')),
  ADD CONSTRAINT mission_questions_fun_type_check
    CHECK (fun_type IN ('imagination', 'balance_choice', 'teach_k', 'playful_story', 'reflection', 'none')),
  ADD CONSTRAINT mission_questions_sensitivity_check CHECK (sensitivity IN ('low', 'medium', 'high')),
  ADD CONSTRAINT mission_questions_answer_mode_check
    CHECK (answer_mode IN ('optional_open', 'metaphor', 'choice', 'short_open', 'open')),
  ADD CONSTRAINT mission_questions_periodicity_check
    CHECK (periodicity IN ('onboarding_once', 'flexible', 'weekly', 'monthly', 'quarterly'));

CREATE INDEX IF NOT EXISTS idx_mission_questions_semantic_group
  ON public.mission_questions (semantic_group)
  WHERE is_active = true;

COMMENT ON COLUMN public.mission_questions.semantic_group IS '질문 ID와 무관하게 반복 의미를 묶는 071 공용 topic namespace key';
COMMENT ON COLUMN public.mission_questions.cooldown_days IS 'K가 이 semantic_group을 먼저 다시 제안하기 전 대기 일수';
COMMENT ON COLUMN public.mission_questions.weekday_affinity IS '요일 고정 세트가 아닌 가중치 힌트(mon..sun), 빈 배열은 요일 중립';
COMMENT ON COLUMN public.mission_questions.memory_usable IS '장기 관계 기억 후보로 재사용할 가치가 있는 질문인지 여부';
