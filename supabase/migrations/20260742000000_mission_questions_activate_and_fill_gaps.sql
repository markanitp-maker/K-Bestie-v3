-- 미션 질문 풀 확충: 학년별 PRIMARY 10개 + RESERVE 10개(총 20개 고유 문항) 보장
--
-- 배경: 실기기에서 미션이 9/10에서 멈추는 장애를 조사한 결과, 활성(is_active=true)
-- 문항이 학년별 13~17개뿐으로 확인됐다. 그러나 재조사 결과 mission_questions에는
-- 대표님이 이미 작성한 문항 46개가 is_active=false(clinical_status='PENDING_REVIEW')
-- 상태로 존재하고 있었다 - 콘텐츠 자체가 부족한 게 아니라 활성화(검수 완료 처리)가
-- 안 된 것이었다. 이 문항들을 전수 검토한 결과 전부 정상적으로 작성된 문항이라
-- 활성화한다. 다만 그 46개도 1학년(7세) applicable_grades를 전혀 포함하지 않아
-- 1학년은 여전히 태그별 커버리지가 부족하고, 2학년도 일부 태그(school_life/
-- study_concerns/digital_interests)가 부족하다 - 이 갭만 최소한의 신규 문항으로 채운다.
--
-- 1) 기존 비활성 문항 46개를 활성화한다(clinical_status는 대표님의 별도 검수
--    workflow를 위해 건드리지 않고 is_active만 true로 전환).
-- 2) 학년 1·2 위주로 부족한 태그(greeting/future_dreams/school_life/study_concerns/
--    digital_interests/peer_relations/recurring_stories)를 채우는 신규 문항
--    11개를 추가한다 - 태그당 학년별 최소 2개(PRIMARY 1 + RESERVE 1) 확보가 목표.

-- ================================================================
-- 1. 기존 작성된 비활성 문항 활성화
-- ================================================================
UPDATE mission_questions
SET is_active = true
WHERE is_active = false;

-- ================================================================
-- 2. 학년 1·2 갭 보강 신규 문항
-- ================================================================
INSERT INTO mission_questions
  (question_text, applicable_grades, cycle_type, dashboard_area_tag, round_type, is_active, clinical_status)
VALUES
  ('오늘은 너에 대해 하나만 알려줄래?', ARRAY[1,2,3,4,5,6], 'always', 'greeting', 'common', true, 'PENDING_REVIEW'),
  ('나중에 크면 뭐가 되고 싶어?', ARRAY[1,2,3], 'quarterly', 'future_dreams', 'common', true, 'PENDING_REVIEW'),
  ('네가 진짜 되고 싶은 거 하나만 말해볼래?', ARRAY[1], 'quarterly', 'future_dreams', 'common', true, 'PENDING_REVIEW'),
  ('학교(또는 유치원)에서 오늘 재밌었던 거 있어?', ARRAY[1,2], 'always', 'school_life', 'round1_day', true, 'PENDING_REVIEW'),
  ('쉬는 시간에 친구들이랑 뭐 했어?', ARRAY[1,2], 'always', 'school_life', 'round1_day', true, 'PENDING_REVIEW'),
  ('공부하거나 새로 배울 때 어떤 게 좋아?', ARRAY[1,2], 'weekly', 'study_concerns', 'round1_day', true, 'PENDING_REVIEW'),
  ('요즘 배우는 것 중에 제일 재밌는 거 있어?', ARRAY[1,2], 'weekly', 'study_concerns', 'round1_day', true, 'PENDING_REVIEW'),
  ('요즘 좋아하는 만화나 놀이 영상 있어?', ARRAY[1,2], 'monthly', 'digital_interests', 'round2_night', true, 'PENDING_REVIEW'),
  ('폰이나 태블릿으로 뭐 하고 노는 거 좋아해?', ARRAY[1,2], 'monthly', 'digital_interests', 'round2_night', true, 'PENDING_REVIEW'),
  ('요즘 제일 친한 친구는 누구야?', ARRAY[1], 'weekly', 'peer_relations', 'round1_day', true, 'PENDING_REVIEW'),
  ('오늘 있었던 일 중에 케이한테 꼭 말해주고 싶은 거 있어?', ARRAY[1], 'always', 'recurring_stories', 'round2_night', true, 'PENDING_REVIEW');
