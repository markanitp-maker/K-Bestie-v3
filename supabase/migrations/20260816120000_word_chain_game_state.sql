-- 자유대화 끝말잇기(WORD_CHAIN)의 세션 상태와 턴/라운드별 기록을 저장한다.
-- K Conversation Engine은 턴마다 상태를 읽고 갱신하는 stateless 구조를 유지한다.
-- 게임 상태는 서버 서비스 롤만 접근하며, 클라이언트는 서버 API를 경유한다.
-- child당 종료되지 않은 게임 세션은 하나만 허용해 상태 충돌을 막는다.

-- [상태값(state) 정의 및 근거]
-- 초성게임은 문제출제, 힌트제공, 정답대기 등 퀴즈 진행 상태(WAITING_FOR_ANSWER, HINT, ROUND_RESULT 등)를 갖지만,
-- 끝말잇기는 단어를 연속해서 릴레이로 주고받는 턴제 게임이므로
-- CHILD_TURN (아이 입력 차례), K_TURN (K 턴 처리 차례), SUSPENDED (주제전환/일시중단), ENDED (종료)
-- 의 턴 기반 상태 머신을 사용한다 (§3-9).

-- [requiredStartSyllable 및 roundCount 비저장 근거]
-- 1. requiredStartSyllable: 직전에 확정된 current_word의 마지막 음절(lastSyllable) 및 두음법칙에 의해
--    런타임 규칙 엔진(dueum.ts 등)에서 결정론적으로 파생(derivable)되므로 컬럼으로 중복 저장하지 않는다 (§3-10).
-- 2. roundCount: 누적된 used_words 배열의 길이(cardinality(used_words)) 또는 word_chain_game_rounds 기록 수에서
--    단일 진실 공급원(Single Source of Truth)으로 파생되므로 컬럼으로 중복 저장하지 않는다 (§3-10).

CREATE TABLE IF NOT EXISTS word_chain_game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  -- chat_session_id는 chat_sessions.id만 FK로 강제한다. chat_sessions(id, child_id) 복합
  -- UNIQUE를 추가해 (chat_session_id, child_id) 복합 FK로 동일-아이 불변식까지 DB에서 강제하는
  -- 방안도 검토했으나, chat_sessions는 보호 대상 핵심 테이블(§ DB 13개 테이블 변경 금지)이라
  -- 손대지 않는다. 대신 서버 로직은 child_id를 클라이언트 입력으로 받지 않고 반드시 조회한
  -- chat_sessions.child_id에서 파생시켜 동일-아이 불변식을 보장한다.
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD', 'K')),
  state TEXT NOT NULL CHECK (state IN (
    'CHILD_TURN',
    'K_TURN',
    'SUSPENDED',
    'ENDED'
  )),
  current_word TEXT,
  current_difficulty INT NOT NULL,
  used_words TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (id, child_id)
);

-- 아이 1명당 종료되지 않은 끝말잇기 게임 세션 1개만 유지해 동시 게임 상태 충돌을 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_word_chain_game_sessions_child_active
  ON word_chain_game_sessions(child_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS word_chain_game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES word_chain_game_sessions(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  by TEXT NOT NULL CHECK (by IN ('CHILD', 'K')),
  difficulty INT NOT NULL,
  -- chainRules의 판정 결과(accepted/rejection) 및 턴 결과와 정합
  result TEXT NOT NULL CHECK (result IN (
    'ACCEPTED',
    'EMPTY',
    'NOT_HANGUL',
    'NOT_IN_DICTIONARY',
    'ALREADY_USED',
    'CHAIN_MISMATCH',
    'GIVE_UP'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, child_id)
    REFERENCES word_chain_game_sessions(id, child_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_word_chain_game_rounds_child_created_at
  ON word_chain_game_rounds(child_id, created_at);

ALTER TABLE word_chain_game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_chain_game_rounds ENABLE ROW LEVEL SECURITY;

-- 서비스 롤 전용 — 아이/부모 클라이언트는 직접 접근하지 않고 항상 서버 API를 경유한다.
-- anon/authenticated GRANT는 하드룰(AGENTS.md §9)에 따라 부여하되 실제 행 접근은
-- RLS로 서비스 롤 전용으로 막는다.
GRANT ALL ON word_chain_game_sessions TO anon, authenticated;
GRANT ALL ON word_chain_game_rounds TO anon, authenticated;

DROP POLICY IF EXISTS "word_chain_game_sessions_service_only" ON word_chain_game_sessions;
CREATE POLICY "word_chain_game_sessions_service_only"
  ON word_chain_game_sessions FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "word_chain_game_rounds_service_only" ON word_chain_game_rounds;
CREATE POLICY "word_chain_game_rounds_service_only"
  ON word_chain_game_rounds FOR ALL
  USING (false)
  WITH CHECK (false);
