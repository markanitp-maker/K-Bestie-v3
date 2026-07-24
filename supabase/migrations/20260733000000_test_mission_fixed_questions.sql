-- Plan01 §7.1: 테스트 계정 A~E 비교용 '고정 10개 질문'(question_id 01~10).
-- testi01/testi02가 A~E 어느 모드로 시작해도 동일한 10개 질문·순서를 재사용해 모드 간 공정 비교.
-- 일반 사용자·기존 미션의 질문 선택 로직(selectFixedMissionQuestions 등)은 변경하지 않는다.
-- 서버(service_role) 전용 픽스처 테이블.

CREATE TABLE IF NOT EXISTS test_mission_fixed_questions (
  order_index        INT PRIMARY KEY CHECK (order_index BETWEEN 1 AND 10),
  dashboard_area_tag TEXT NOT NULL,
  question_id        UUID NOT NULL REFERENCES mission_questions(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 서버(service_role) 전용: 이 픽스처는 test-mission/start 엔드포인트가 service client로만 읽는다.
-- anon/authenticated GRANT를 부여하지 않는 것은 의도된 예외(일반 사용자 직접 접근 불필요).
ALTER TABLE test_mission_fixed_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_mission_fixed_questions_service_all"
  ON test_mission_fixed_questions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 멱등 seed: 10개 고정 슬롯마다 활성·4학년 대상 질문 1개(id 오름차순 결정론적)를 채운다.
-- 질문 UUID를 하드코딩하지 않고 mission_questions에서 결정론적으로 선택 → 환경 간 재현 가능.
INSERT INTO test_mission_fixed_questions (order_index, dashboard_area_tag, question_id)
SELECT s.ord, s.tag,
  (SELECT q.id FROM mission_questions q
   WHERE q.dashboard_area_tag = s.tag AND q.is_active = true AND 4 = ANY(q.applicable_grades)
   ORDER BY q.id LIMIT 1)
FROM (VALUES
  (1,'greeting'),(2,'school_life'),(3,'peer_relations'),(4,'emotion'),(5,'interests'),
  (6,'study_concerns'),(7,'digital_interests'),(8,'future_dreams'),(9,'recurring_stories'),(10,'daily_general')
) AS s(ord, tag)
WHERE (SELECT q.id FROM mission_questions q
       WHERE q.dashboard_area_tag = s.tag AND q.is_active = true AND 4 = ANY(q.applicable_grades)
       ORDER BY q.id LIMIT 1) IS NOT NULL
ON CONFLICT (order_index) DO NOTHING;
