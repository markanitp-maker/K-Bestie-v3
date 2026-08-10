-- 073 Phase 2 보정 마이그레이션 — claude-review-073-phase2 반려 [복잡] 2건 대응.
-- 20260810200000_mission_question_metadata.sql이 이미 Dev에 적용된 뒤 발견된
-- 결함이라, 원본 파일을 고치는 대신 재분류를 다시 적용하는 보정 파일로 처리한다.
-- 모든 UPDATE가 조건 없이 전체 행을 대상으로 하는 결정론적 재계산이라 몇 번을
-- 다시 실행해도 같은 결과를 내는 자연 멱등(idempotent) 구조다.

-- ============================================================
-- C-2 수정: FUTURE_HOPE의 '해보고 싶' 패턴이 지나치게 넓어 일상/취미/관심사/가족
-- 질문(38개 중 23개, 60%)을 흡수했다. 패턴을 진짜 장래·미래 관련 표현으로
-- 좁히고, HOBBY_AND_CREATION/INTEREST_AND_PREFERENCE/FAMILY_RELATIONSHIP/
-- DAILY_HIGHLIGHT/DAILY_LIFE보다 뒤에서 평가되도록 순서도 조정한다
-- (원본 CASE와 동일한 WHEN 절을 그대로 재사용하되 FUTURE_HOPE 절만 좁히고
-- 뒤로 옮긴다).
-- ============================================================
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
  -- C-2: '해보고 싶'을 제거하고 진짜 장래·진로 표현으로만 좁혔다. 위의 취미/관심사/
  -- 가족/일상 분기들보다 뒤에서 평가되므로, 그 분기가 이미 잡아낸 "해보고 싶은 일"류
  -- 질문은 여기까지 내려오지 않는다.
  WHEN dashboard_area_tag = 'future_dreams'
    OR question_text ~ '(커서.*되고 싶|꿈이|장래|미래에|중학교.*기대)'
    THEN 'FUTURE_HOPE'
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

-- ============================================================
-- C-1 수정: conversation_topics는 (child_id, semantic_group) 1행만 유지하므로,
-- 그 그룹에서 어떤 질문이 뽑히든 같은 공용 cooldown_until에 쓰인다. periodicity
-- 기반 장기값(quarterly=90/monthly=30/weekly=7)을 그대로 group cooldown에 쓰면
-- 분기 질문 1건이 그룹 전체(최대 100+행)를 최대 90일 봉쇄한다. 주기 질문의
-- 재출제 억제는 이미 lib/mission/selectQuestions.ts가 mission_question_history +
-- CYCLE_INTERVAL_DAYS[cycle_type]로 질문 단위로 처리하고 있으므로, Phase 2의
-- 그룹 cooldown은 periodicity를 더 이상 참조하지 않고 민감도 기반의 짧은 값만
-- 쓴다(최대 14일).
-- ============================================================
UPDATE public.mission_questions
SET cooldown_days = CASE
  WHEN sensitivity = 'high' THEN 14
  WHEN sensitivity = 'medium' THEN 7
  WHEN semantic_group IN ('INTEREST_AND_PREFERENCE', 'FUTURE_HOPE', 'RAPPORT_IDENTITY') THEN 7
  WHEN semantic_group IN ('MEAL_AND_TASTE', 'PHYSICAL_STATE') THEN 1
  ELSE 3
END;

DO $$
DECLARE
  incomplete_count BIGINT;
  over_cap_count BIGINT;
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

  SELECT count(*) INTO over_cap_count FROM public.mission_questions WHERE cooldown_days > 14;
  IF over_cap_count > 0 THEN
    RAISE EXCEPTION 'mission_questions cooldown_days exceeds 14-day group cap: % rows (C-1 regression)', over_cap_count;
  END IF;
END $$;
