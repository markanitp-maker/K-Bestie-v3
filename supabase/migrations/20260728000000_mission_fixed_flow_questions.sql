-- 미션 고정 순서(인사+8영역+랜덤일상) 구조를 위한 신규 질문 행 추가.
-- 기존 mission_questions 스키마(UUID PK, UUID[] 참조 체계)를 그대로 활용하기 위해
-- "가짜 문자열 ID"가 아니라 실제 DB 행으로 인사질문/일상질문 풀을 만든다.
-- 기존 데이터는 전혀 변경하지 않음(신규 INSERT + CHECK 제약 확장만).

ALTER TABLE mission_questions
  DROP CONSTRAINT IF EXISTS mission_questions_dashboard_area_tag_check;

ALTER TABLE mission_questions
  ADD CONSTRAINT mission_questions_dashboard_area_tag_check
  CHECK (dashboard_area_tag = ANY (ARRAY[
    'school_life', 'peer_relations', 'emotion', 'interests',
    'study_concerns', 'digital_interests', 'future_dreams', 'recurring_stories',
    'greeting', 'daily_general'
  ]::text[]));

-- 인사 질문(1번, 고정) — 전 학년/전 라운드, 항상 활성.
INSERT INTO mission_questions
  (question_text, applicable_grades, cycle_type, dashboard_area_tag, round_type, is_active, clinical_status)
VALUES
  ('안녕, 나는 케이야. 넌 누구니?', ARRAY[1,2,3,4,5,6], 'always', 'greeting', 'common', true, 'APPROVED')
ON CONFLICT DO NOTHING;

-- 10번째(랜덤 일상) 질문 풀 — 과거 대화를 전제하지 않는 일반적인 질문 5개.
INSERT INTO mission_questions
  (question_text, applicable_grades, cycle_type, dashboard_area_tag, round_type, is_active, clinical_status)
VALUES
  ('오늘 하루 중에 제일 재밌었던 순간이 언제야?', ARRAY[1,2,3,4,5,6], 'always', 'daily_general', 'common', true, 'APPROVED'),
  ('오늘 점심(또는 저녁)에 뭐 먹었어?', ARRAY[1,2,3,4,5,6], 'always', 'daily_general', 'common', true, 'APPROVED'),
  ('지금 제일 하고 싶은 게 뭐야?', ARRAY[1,2,3,4,5,6], 'always', 'daily_general', 'common', true, 'APPROVED'),
  ('오늘 날씨 어땠어?', ARRAY[1,2,3,4,5,6], 'always', 'daily_general', 'common', true, 'APPROVED'),
  ('지금 기분을 색깔로 말하면 무슨 색이야?', ARRAY[1,2,3,4,5,6], 'always', 'daily_general', 'common', true, 'APPROVED')
ON CONFLICT DO NOTHING;
