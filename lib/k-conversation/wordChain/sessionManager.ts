import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 끝말잇기(WORD_CHAIN) 세션 상태 머신 (§3-9, §3-24).
 * - CHILD_TURN: 아이가 다음 단어를 입력할 차례
 * - K_TURN: K가 다음 단어를 결정/생성할 차례 (턴 처리 중)
 * - SUSPENDED: 주제 전환(Topic Shift)이나 일시 중단 상태
 * - ENDED: 게임 종료 (정상 종료 또는 아이 중단 요청)
 */
export type WordChainSessionState =
  | "CHILD_TURN"
  | "K_TURN"
  | "SUSPENDED"
  | "ENDED";

export type WordChainInitiatedBy = "CHILD" | "K";

/**
 * 라운드 결과 판정 (chainRules Rejection 및 정상 연결과 정합).
 */
export type WordChainTurnResult =
  | "ACCEPTED"
  | "EMPTY"
  | "NOT_HANGUL"
  | "NOT_IN_DICTIONARY"
  | "ALREADY_USED"
  | "CHAIN_MISMATCH"
  | "GIVE_UP";

/**
 * DB word_chain_game_sessions 테이블 매핑 인터페이스 (§3-10).
 * [주의] requiredStartSyllable과 roundCount는 저장 컬럼이 아니라
 * current_word 및 used_words에서 런타임에 파생(derivable)되는 값입니다.
 */
export interface WordChainSessionRow {
  id: string;
  child_id: string;
  chat_session_id: string;
  initiated_by: WordChainInitiatedBy;
  state: WordChainSessionState;
  current_word: string | null;
  current_difficulty: number;
  used_words: string[];
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface WordChainRoundRow {
  id: string;
  session_id: string;
  child_id: string;
  word: string;
  by: "CHILD" | "K";
  difficulty: number;
  result: WordChainTurnResult;
  created_at: string;
}

export interface StartWordChainSessionParams {
  chatSessionId: string;
  childId?: string;
  initiatedBy?: WordChainInitiatedBy;
  initialWord?: string | null;
  initialDifficulty?: number;
  gradeRaw?: string | number | null;
}

export interface RecordWordChainTurnParams {
  sessionId: string;
  childId?: string;
  word: string;
  by: "CHILD" | "K";
  result: WordChainTurnResult;
  difficulty?: number;
  nextState?: WordChainSessionState;
  currentSession?: WordChainSessionRow;
}

/**
 * 런타임 파생값 헬퍼: 현재 세션의 라운드 수 (used_words 길이에서 파생, §3-10).
 */
export function getDerivedRoundCount(session: WordChainSessionRow): number {
  return Array.isArray(session.used_words) ? session.used_words.length : 0;
}

/**
 * 런타임 파생값 헬퍼: 다음 차례에 요구되는 시작 음절 (current_word 마지막 음절에서 파생, §3-10).
 */
export function getRequiredStartSyllable(
  session: WordChainSessionRow
): string | null {
  if (!session.current_word || typeof session.current_word !== "string") {
    return null;
  }
  const trimmed = session.current_word.trim();
  return trimmed.length > 0 ? trimmed.slice(-1) : null;
}

/**
 * 1. 끝말잇기 게임 세션 시작
 * - child_id는 클라이언트 입력을 신뢰하지 않고 chat_sessions에서 안전하게 파생합니다 (§5).
 * - 아이 1명당 활성 세션이 이미 존재하면 새로 만들지 않고 기존 세션을 즉시 반환합니다.
 * - DB 실패 시 예외를 던지지 않고 안전한 fallback 행을 반환합니다.
 */
export async function startWordChainSession(
  db: SupabaseClient,
  params: StartWordChainSessionParams
): Promise<WordChainSessionRow> {
  const {
    chatSessionId,
    childId: paramChildId,
    initiatedBy = "K",
    initialWord = null,
    initialDifficulty = 1,
  } = params;

  let derivedChildId = paramChildId || "";

  // 1) chat_sessions에서 실제 child_id 조회 및 파생 (§5)
  if (chatSessionId) {
    try {
      const { data: chatSession, error: chatErr } = await db
        .from("chat_sessions")
        .select("child_id")
        .eq("id", chatSessionId)
        .maybeSingle();

      if (!chatErr && chatSession?.child_id) {
        derivedChildId = chatSession.child_id;
      }
    } catch (err) {
      console.error(
        "[startWordChainSession] chat_sessions lookup error:",
        err
      );
    }
  }

  // 2) 이미 활성 세션(ended_at IS NULL)이 존재하는지 확인 -> 중복 생성 방지
  if (derivedChildId) {
    const existingActive = await getActiveWordChainSession(db, derivedChildId);
    if (existingActive) {
      return existingActive;
    }
  }

  // 3) 신규 세션 생성
  const initialUsedWords = initialWord ? [initialWord] : [];
  const initialState: WordChainSessionState = "CHILD_TURN";
  const nowStr = new Date().toISOString();

  try {
    const { data, error } = await db
      .from("word_chain_game_sessions")
      .insert({
        child_id: derivedChildId,
        chat_session_id: chatSessionId,
        initiated_by: initiatedBy,
        state: initialState,
        current_word: initialWord,
        current_difficulty: initialDifficulty,
        used_words: initialUsedWords,
        started_at: nowStr,
        updated_at: nowStr,
      })
      .select()
      .single();

    if (error || !data) {
      // Race condition이나 동시 생성 충돌 시 활성 세션 재조회
      if (derivedChildId) {
        const retryActive = await getActiveWordChainSession(db, derivedChildId);
        if (retryActive) {
          return retryActive;
        }
      }

      console.error(
        `[startWordChainSession] DB insert error: ${error?.message ?? "No data returned"}`
      );

      // 예외를 밖으로 던지지 않고 안전한 세션 반환
      return {
        id: `fallback-session-${Date.now()}`,
        child_id: derivedChildId,
        chat_session_id: chatSessionId,
        initiated_by: initiatedBy,
        state: initialState,
        current_word: initialWord,
        current_difficulty: initialDifficulty,
        used_words: initialUsedWords,
        started_at: nowStr,
        updated_at: nowStr,
        ended_at: null,
      };
    }

    return data as WordChainSessionRow;
  } catch (err) {
    console.error("[startWordChainSession] Unexpected error:", err);
    if (derivedChildId) {
      const retryActive = await getActiveWordChainSession(db, derivedChildId);
      if (retryActive) {
        return retryActive;
      }
    }

    return {
      id: `fallback-session-${Date.now()}`,
      child_id: derivedChildId,
      chat_session_id: chatSessionId,
      initiated_by: initiatedBy,
      state: initialState,
      current_word: initialWord,
      current_difficulty: initialDifficulty,
      used_words: initialUsedWords,
      started_at: nowStr,
      updated_at: nowStr,
      ended_at: null,
    };
  }
}

/**
 * 2. 현재 활성 게임 세션 조회
 * - child_id 기준 ended_at IS NULL인 세션을 반환합니다.
 * - 실패 시 예외를 던지지 않고 null을 반환합니다.
 */
/**
 * 이 아이가 최근 끝말잇기에서 K 의 첫 단어로 썼던 낱말들(010 §3-4).
 *
 * 같은 첫 단어가 반복되는 것을 막기 위한 제외 목록이다. 라운드 기록에서 K 가 낸
 * 첫 낱말만 모은다. 실패하면 빈 배열을 돌려준다 — 제외를 못 해도 게임은 되어야 한다.
 */
export async function getRecentInitialKWords(
  db: SupabaseClient,
  childId: string,
  limit = 20
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("word_chain_game_rounds")
      .select("session_id, word, by, created_at")
      .eq("child_id", childId)
      .eq("by", "K")
      .order("created_at", { ascending: false })
      .limit(limit * 6);
    if (error || !data) return [];

    // 세션별 가장 이른 K 낱말이 그 게임의 첫 단어다.
    const firstBySession = new Map<string, { word: string; createdAt: string }>();
    for (const row of data) {
      const sessionId = row.session_id as string;
      const createdAt = row.created_at as string;
      const existing = firstBySession.get(sessionId);
      if (!existing || createdAt < existing.createdAt) {
        firstBySession.set(sessionId, { word: row.word as string, createdAt });
      }
    }
    return [...new Set([...firstBySession.values()].map((entry) => entry.word))].slice(0, limit);
  } catch (error) {
    console.error("[wordChain/sessionManager] 최근 첫 단어 조회 실패", error);
    return [];
  }
}

export async function getActiveWordChainSession(
  db: SupabaseClient,
  childId: string
): Promise<WordChainSessionRow | null> {
  if (!childId) return null;

  try {
    const { data, error } = await db
      .from("word_chain_game_sessions")
      .select("*")
      .eq("child_id", childId)
      .is("ended_at", null)
      .maybeSingle();

    if (error) {
      console.error("[getActiveWordChainSession] DB select error:", error.message);
      return null;
    }

    return data as WordChainSessionRow | null;
  } catch (err) {
    console.error("[getActiveWordChainSession] Unexpected error:", err);
    return null;
  }
}

/**
 * 3. 턴 및 라운드 결과 기록
 * - word_chain_game_rounds에 판정 결과(result)를 기록합니다.
 * - 단어 유효성/규칙 판정은 chainRules에 위임하며, 세션 매니저는 accepted된 단어를 used_words에 누적합니다.
 * - 실패 시 예외를 던지지 않고 안전한 세션 상태를 반환합니다.
 */
export async function recordWordChainTurn(
  db: SupabaseClient,
  params: RecordWordChainTurnParams
): Promise<WordChainSessionRow> {
  const { sessionId, childId, word, by, result, difficulty, nextState, currentSession } =
    params;
  const nowStr = new Date().toISOString();

  try {
    let session: WordChainSessionRow;

    if (currentSession && currentSession.id === sessionId) {
      session = currentSession;
    } else {
      // 1) 세션 조회
      let sessionQuery = db
        .from("word_chain_game_sessions")
        .select("*")
        .eq("id", sessionId);

      if (childId) {
        sessionQuery = sessionQuery.eq("child_id", childId);
      }

      const { data: sessionData, error: sessionErr } = await sessionQuery
        .is("ended_at", null)
        .single();

      if (sessionErr || !sessionData) {
        console.error(
          "[recordWordChainTurn] active session not found:",
          sessionErr?.message
        );
        return {
          id: sessionId,
          child_id: childId ?? "",
          chat_session_id: "",
          initiated_by: "K",
          state: "CHILD_TURN",
          current_word: word,
          current_difficulty: difficulty ?? 1,
          used_words: word ? [word] : [],
          started_at: nowStr,
          updated_at: nowStr,
          ended_at: null,
        };
      }

      session = sessionData as WordChainSessionRow;
    }

    // 2) 라운드 기록 삽입
    const turnDifficulty = difficulty ?? session.current_difficulty;
    const { error: roundErr } = await db.from("word_chain_game_rounds").insert({
      session_id: session.id,
      child_id: session.child_id,
      word,
      by,
      difficulty: turnDifficulty,
      result,
      created_at: nowStr,
    });

    if (roundErr) {
      console.error(
        "[recordWordChainTurn] failed to insert round:",
        roundErr.message
      );
    }

    // 3) 세션 상태 갱신: ACCEPTED인 경우에만 current_word 및 used_words 갱신
    const currentUsedWords = Array.isArray(session.used_words)
      ? [...session.used_words]
      : [];

    let updatedWord = session.current_word;
    if (result === "ACCEPTED") {
      updatedWord = word;
      if (!currentUsedWords.includes(word)) {
        currentUsedWords.push(word);
      }
    }

    const resolvedState: WordChainSessionState =
      nextState ?? (by === "CHILD" ? "K_TURN" : "CHILD_TURN");

    const { data: updatedSession, error: updateErr } = await db
      .from("word_chain_game_sessions")
      .update({
        current_word: updatedWord,
        current_difficulty: turnDifficulty,
        used_words: currentUsedWords,
        state: resolvedState,
        updated_at: nowStr,
      })
      .eq("id", session.id)
      .select()
      .single();

    if (updateErr || !updatedSession) {
      console.error(
        "[recordWordChainTurn] failed to update session:",
        updateErr?.message
      );
      return {
        ...session,
        current_word: updatedWord,
        current_difficulty: turnDifficulty,
        used_words: currentUsedWords,
        state: resolvedState,
        updated_at: nowStr,
      };
    }

    return updatedSession as WordChainSessionRow;
  } catch (err) {
    console.error("[recordWordChainTurn] Unexpected error:", err);
    return {
      id: sessionId,
      child_id: childId ?? "",
      chat_session_id: "",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: word,
      current_difficulty: difficulty ?? 1,
      used_words: word ? [word] : [],
      started_at: nowStr,
      updated_at: nowStr,
      ended_at: null,
    };
  }
}

/**
 * 4. 세션 종료
 * - state를 ENDED로 바꾸고 ended_at을 기록합니다.
 * - 실패 시 예외를 던지지 않고 에러 로그만 남깁니다.
 */
export async function endWordChainSession(
  db: SupabaseClient,
  sessionId: string,
  childId?: string
): Promise<void> {
  if (!sessionId) return;
  const nowStr = new Date().toISOString();

  try {
    let query = db
      .from("word_chain_game_sessions")
      .update({
        state: "ENDED",
        ended_at: nowStr,
        updated_at: nowStr,
      })
      .eq("id", sessionId);

    if (childId) {
      query = query.eq("child_id", childId);
    }

    const { error } = await query;
    if (error) {
      console.error(
        "[endWordChainSession] DB update error:",
        error.message
      );
    }
  } catch (err) {
    console.error("[endWordChainSession] Unexpected error:", err);
  }
}
