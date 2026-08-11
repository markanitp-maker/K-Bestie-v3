-- 자유대화 초성게임의 세션 상태와 라운드별 telemetry를 저장한다.
-- Engine은 턴마다 상태를 읽고 갱신하는 stateless 구조를 유지한다.
-- 게임 상태는 서버 서비스 롤만 접근하며, 클라이언트는 서버 API를 경유한다.
-- child당 종료되지 않은 게임 세션은 하나만 허용해 상태 충돌을 막는다.

CREATE TABLE IF NOT EXISTS chosung_game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  -- chat_session_id는 chat_sessions.id만 FK로 강제한다. chat_sessions(id, child_id) 복합
  -- UNIQUE를 추가해 (chat_session_id, child_id) 복합 FK로 동일-아이 불변식까지 DB에서 강제하는
  -- 방안도 검토했으나, chat_sessions는 보호 대상 핵심 테이블(§ DB 13개 테이블 변경 금지)이라
  -- 이 신규 기능 하나를 위해 손대지 않기로 했다(2026-08-11 Claude 설계 판단). 대신 이 값을
  -- 쓰는 Phase 5 서버 로직은 child_id를 클라이언트 입력으로 받지 않고 반드시 조회한
  -- chat_sessions.child_id에서 파생시켜야 한다 — 이 규약이 실질적인 불변식 보장 수단이다.
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN (
    'OFFERED',
    'PLAYING_K_ASKS',
    'PLAYING_CHILD_ASKS',
    'WAITING_FOR_ANSWER',
    'HINT',
    'ROUND_RESULT',
    'ENDED'
  )),
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD', 'K')),
  current_word TEXT,
  current_chosung TEXT,
  current_category TEXT,
  current_difficulty INT NOT NULL,
  hint_level INT NOT NULL DEFAULT 0,
  recent_words TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (id, child_id)
);

-- 아이 1명당 종료되지 않은 초성게임 세션 1개만 유지해 동시 게임 상태 충돌을 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chosung_game_sessions_child_active
  ON chosung_game_sessions(child_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS chosung_game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chosung_game_sessions(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL DEFAULT 'CHOSUNG',
  difficulty INT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('correct', 'skip', 'revealed', 'child_asked')),
  hint_used INT NOT NULL DEFAULT 0,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD', 'K')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, child_id)
    REFERENCES chosung_game_sessions(id, child_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chosung_game_rounds_child_created_at
  ON chosung_game_rounds(child_id, created_at);

ALTER TABLE chosung_game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chosung_game_rounds ENABLE ROW LEVEL SECURITY;

-- 서비스 롤 전용 — 아이/부모 클라이언트는 직접 접근하지 않고 항상 서버 API를 경유한다.
-- anon/authenticated GRANT는 하드룰(AGENTS.md §5)에 따라 부여하되 실제 행 접근은
-- RLS로 서비스 롤 전용으로 막는다.
GRANT ALL ON chosung_game_sessions TO anon, authenticated;
GRANT ALL ON chosung_game_rounds TO anon, authenticated;

DROP POLICY IF EXISTS "chosung_game_sessions_service_only" ON chosung_game_sessions;
CREATE POLICY "chosung_game_sessions_service_only"
  ON chosung_game_sessions FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "chosung_game_rounds_service_only" ON chosung_game_rounds;
CREATE POLICY "chosung_game_rounds_service_only"
  ON chosung_game_rounds FOR ALL
  USING (false)
  WITH CHECK (false);
