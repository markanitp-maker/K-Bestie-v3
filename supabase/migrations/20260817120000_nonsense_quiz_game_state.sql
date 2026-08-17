-- ==============================================================================
-- 008-A 넌센스 퀴즈(NONSENSE_QUIZ_SKILL) 데이터베이스 기반 구축
--
-- 1. nonsense_questions: 검수된 넌센스 퀴즈 Question Bank (시드 500문항 적재 대상)
-- 2. nonsense_game_sessions: 자유대화 넌센스 퀴즈 세션 상태 관리 (chosung/word_chain과 동일한 convention)
-- 3. nonsense_question_history: 아이별 문제 출제 이력 추적 (180일 쿨다운 및 중도 이탈 반복 방지)
--
-- * 실행 주의: DDL 파일 생성 전용이며, 이 조각에서 DB 실행하지 않음 (다음 단계에서 수동/승인 적용).
-- ==============================================================================

-- 1) nonsense_questions: 문제 뱅크
CREATE TABLE IF NOT EXISTS nonsense_questions (
  id TEXT PRIMARY KEY,
  concept_key TEXT NOT NULL,
  question TEXT NOT NULL,
  canonical_answer TEXT NOT NULL,
  accepted_answers TEXT[] NOT NULL DEFAULT '{}',
  hint_1 TEXT,
  hint_2 TEXT,
  explanation TEXT,
  category TEXT,
  pun_type TEXT,
  difficulty INT NOT NULL CHECK (difficulty BETWEEN 1 AND 6),
  min_grade INT NOT NULL CHECK (min_grade BETWEEN 1 AND 6),
  max_grade INT NOT NULL CHECK (max_grade BETWEEN 1 AND 6),
  primary_grade_band TEXT,
  status TEXT NOT NULL DEFAULT 'REVIEW' CHECK (status IN ('ACTIVE', 'REVIEW', 'REJECTED', 'DEPRECATED')),
  child_safe BOOLEAN NOT NULL DEFAULT true,
  source_type TEXT,
  quality_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_nonsense_questions_concept_key UNIQUE (concept_key),
  CONSTRAINT check_nonsense_questions_grade_range CHECK (min_grade <= max_grade)
);

-- 학년/난이도/상태/안전 기반 문제 선택 고속 조회를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_nonsense_questions_selector
  ON nonsense_questions (status, child_safe, min_grade, max_grade, difficulty);

CREATE INDEX IF NOT EXISTS idx_nonsense_questions_status_grades
  ON nonsense_questions (status, min_grade, max_grade);

-- 2) nonsense_game_sessions: 게임 세션 상태
CREATE TABLE IF NOT EXISTS nonsense_game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD', 'K')),
  state TEXT NOT NULL CHECK (state IN (
    'OFFERED',
    'PLAYING_K_ASKS',
    'PLAYING_CHILD_ASKS',
    'WAITING_FOR_ANSWER',
    'HINT',
    'ROUND_RESULT',
    'SUSPENDED',
    'ENDED'
  )),
  current_question_id TEXT REFERENCES nonsense_questions(id) ON DELETE SET NULL,
  current_difficulty INT NOT NULL DEFAULT 1 CHECK (current_difficulty BETWEEN 1 AND 6),
  hint_level INT NOT NULL DEFAULT 0,
  recent_question_ids TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (id, child_id)
);

-- 아이 1명당 종료되지 않은 넌센스 퀴즈 게임 세션 1개만 유지
CREATE UNIQUE INDEX IF NOT EXISTS uq_nonsense_game_sessions_child_active
  ON nonsense_game_sessions (child_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nonsense_game_sessions_chat_session
  ON nonsense_game_sessions (chat_session_id);

-- 3) nonsense_question_history: 아이별 문제 출제 이력
CREATE TABLE IF NOT EXISTS nonsense_question_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES nonsense_questions(id) ON DELETE CASCADE,
  chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  game_session_id UUID REFERENCES nonsense_game_sessions(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL DEFAULT 'PRESENTED' CHECK (outcome IN ('PRESENTED', 'ANSWERED', 'SKIPPED', 'ANSWERED_CORRECT', 'ANSWERED_INCORRECT', 'TOPIC_SHIFT')),
  presented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  hint_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 180일 쿨다운 체크 및 아이별 특정 문제 제시 여부 초고속 색인
CREATE INDEX IF NOT EXISTS idx_nonsense_history_child_question_presented
  ON nonsense_question_history (child_id, question_id, presented_at DESC);

CREATE INDEX IF NOT EXISTS idx_nonsense_history_child_presented
  ON nonsense_question_history (child_id, presented_at DESC);

CREATE INDEX IF NOT EXISTS idx_nonsense_history_game_session
  ON nonsense_question_history (game_session_id);

-- RLS 활성화 및 권한 설정
ALTER TABLE nonsense_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonsense_game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonsense_question_history ENABLE ROW LEVEL SECURITY;

-- AGENTS.md §9 하드룰에 따른 GRANT 설정
GRANT ALL ON nonsense_questions TO anon, authenticated;
GRANT ALL ON nonsense_game_sessions TO anon, authenticated;
GRANT ALL ON nonsense_question_history TO anon, authenticated;

-- 서비스 롤 전용 정책 (클라이언트는 서버 API 경유)
DROP POLICY IF EXISTS "nonsense_questions_service_only" ON nonsense_questions;
CREATE POLICY "nonsense_questions_service_only"
  ON nonsense_questions FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "nonsense_game_sessions_service_only" ON nonsense_game_sessions;
CREATE POLICY "nonsense_game_sessions_service_only"
  ON nonsense_game_sessions FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "nonsense_question_history_service_only" ON nonsense_question_history;
CREATE POLICY "nonsense_question_history_service_only"
  ON nonsense_question_history FOR ALL
  USING (false)
  WITH CHECK (false);
