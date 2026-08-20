import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PlaySessionLookupError,
  type ActiveSessionLookupOptions,
} from "../play/skillTypes";
import type {
  NonsenseGameSessionRow,
  NonsenseQuestionHistoryRow,
  NonsenseQuestionRow,
  NonsenseSessionState,
  NonsenseInitiatedBy,
  NonsenseHistoryOutcome,
} from "./nonsenseQuizTypes";

export interface StartNonsenseSessionParams {
  childId: string;
  chatSessionId: string;
  question: NonsenseQuestionRow;
  initialDifficulty?: number;
  initiatedBy?: NonsenseInitiatedBy;
}

export interface FinishRoundParams {
  sessionId: string;
  childId: string;
  questionId: string;
  outcome: NonsenseHistoryOutcome;
  hintCount?: number;
  endSession?: boolean;
}

/**
 * 현재 아이의 활성 넌센스 퀴즈 게임 세션을 조회합니다 (ended_at IS NULL, §3-13).
 */
export async function getActiveNonsenseSession(
  db: SupabaseClient,
  childId: string,
  options?: ActiveSessionLookupOptions
): Promise<NonsenseGameSessionRow | null> {
  if (!db || !childId) return null;

  try {
    const { data, error } = await db
      .from("nonsense_game_sessions")
      .select("*")
      .eq("child_id", childId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new PlaySessionLookupError("nonsenseQuiz", error.message);
    }

    return (data as NonsenseGameSessionRow) ?? null;
  } catch (err) {
    if (options?.throwOnError) {
      throw err instanceof PlaySessionLookupError
        ? err
        : new PlaySessionLookupError("nonsenseQuiz", err);
    }
    console.error("[getActiveNonsenseSession] 조회 실패, null 로 처리:", err);
    return null;
  }
}

/**
 * 넌센스 퀴즈 게임 세션을 시작하고, 질문을 아이에게 제시하는 즉시 PRESENTED 이력을 기록합니다 (§3-2, §3-5).
 */
export async function startNonsenseSession(
  db: SupabaseClient,
  params: StartNonsenseSessionParams
): Promise<{
  session: NonsenseGameSessionRow;
  history: NonsenseQuestionHistoryRow;
}> {
  const {
    childId,
    chatSessionId,
    question,
    initialDifficulty = question.difficulty || 1,
    initiatedBy = "K",
  } = params;

  // 1. 기존 활성 세션이 남아있다면 안전하게 종료 (§3-13)
  const existing = await getActiveNonsenseSession(db, childId);
  if (existing) {
    await endNonsenseSession(db, existing.id, childId, "NEW_SESSION_STARTED");
  }

  const nowStr = new Date().toISOString();

  // 2. 신규 세션 생성 (nonsense_game_sessions)
  const sessionInsertData = {
    child_id: childId,
    chat_session_id: chatSessionId,
    initiated_by: initiatedBy,
    state: "WAITING_FOR_ANSWER" as NonsenseSessionState,
    current_question_id: question.id,
    current_difficulty: initialDifficulty,
    hint_level: 0,
    recent_question_ids: [question.id],
    started_at: nowStr,
    updated_at: nowStr,
    ended_at: null,
  };

  const { data: sessionData, error: sessionErr } = await db
    .from("nonsense_game_sessions")
    .insert(sessionInsertData)
    .select()
    .single();

  if (sessionErr || !sessionData) {
    throw new Error(`Session insert failed: ${sessionErr?.message ?? "no data"}`);
  }
  const createdSession = sessionData as NonsenseGameSessionRow;

  // 3. 문제 출제 이력 생성 (nonsense_question_history — PRESENTED 즉시 기록, §3-5)
  const historyInsertData = {
    child_id: childId,
    question_id: question.id,
    chat_session_id: chatSessionId,
    game_session_id: createdSession.id,
    outcome: "PRESENTED" as NonsenseHistoryOutcome,
    presented_at: nowStr,
    answered_at: null,
    hint_count: 0,
    created_at: nowStr,
    updated_at: nowStr,
  };

  try {
    const { data: historyData, error: historyErr } = await db
      .from("nonsense_question_history")
      .insert(historyInsertData)
      .select()
      .single();

    if (historyErr || !historyData) {
      throw new Error(`History insert failed: ${historyErr?.message ?? "no data"}`);
    }
    const createdHistory = historyData as NonsenseQuestionHistoryRow;

    return {
      session: createdSession,
      history: createdHistory,
    };
  } catch (histErr) {
    console.error("[startNonsenseSession] history insert failed, rolling back session:", histErr);
    try {
      await db
        .from("nonsense_game_sessions")
        .delete()
        .eq("id", createdSession.id)
        .eq("child_id", childId);
    } catch {
      await endNonsenseSession(db, createdSession.id, childId, "DB_HISTORY_ERROR");
    }
    throw histErr;
  }
}

/**
 * 힌트 단계 상승 및 힌트 사용 횟수 기록 (§3-10).
 */
export async function advanceHintLevel(
  db: SupabaseClient,
  sessionId: string,
  questionId: string,
  childId: string,
  newHintLevel: number
): Promise<void> {
  const nowStr = new Date().toISOString();

  // 세션 hint_level 갱신
  try {
    await db
      .from("nonsense_game_sessions")
      .update({
        hint_level: newHintLevel,
        state: "HINT",
        updated_at: nowStr,
      })
      .eq("id", sessionId)
      .eq("child_id", childId);
  } catch (err) {
    console.error("[advanceHintLevel] session update error:", err);
  }

  // 이력 hint_count 갱신
  try {
    await db
      .from("nonsense_question_history")
      .update({
        hint_count: newHintLevel,
        updated_at: nowStr,
      })
      .eq("game_session_id", sessionId)
      .eq("question_id", questionId)
      .eq("child_id", childId);
  } catch (err) {
    console.error("[advanceHintLevel] history update error:", err);
  }
}

/**
 * 라운드 결과 기록 (정답 맞힘, 오답 포기/정답공개, 스킵 등, §3-8).
 */
export async function finishQuestionRound(
  db: SupabaseClient,
  params: FinishRoundParams
): Promise<void> {
  const { sessionId, childId, questionId, outcome, hintCount = 0, endSession = true } = params;
  const nowStr = new Date().toISOString();

  // 1. 이력 outcome 및 answered_at 갱신
  try {
    await db
      .from("nonsense_question_history")
      .update({
        outcome,
        answered_at: nowStr,
        hint_count: hintCount,
        updated_at: nowStr,
      })
      .eq("game_session_id", sessionId)
      .eq("question_id", questionId)
      .eq("child_id", childId);
  } catch (err) {
    console.error("[finishQuestionRound] history update error:", err);
  }

  // 2. 세션 상태 전이
  //
  // 010 대표님 QA 실측(2026-08-20 00:13, 세션 7cde49ed): 아이가 "그림자" 로 정답을
  // 맞혔고 케이도 칭찬했는데, 그 뒤 턴에서 **같은 문제를 다시 채점했다** —
  // 00:13:21 힌트, 00:13:57 정답 공개(outcome 이 ANSWERED_CORRECT 에서
  // ANSWERED_INCORRECT 로 덮여 쓰였다). 아이가 "그림자 맞췄는데 또 힌트가 앉아있냐" 고 했다.
  //
  // 원인: state 전이가 `endSession` 안에 묶여 있었다. 정답·정답공개 경로는 세션을
  // 살려 두려고 endSession=false 로 부르는데, 그러면 state 가 그대로 남아 다음 턴이
  // 또 답변 판정 경로로 들어간다(3-C 의 ROUND_RESULT 분기를 타지 못한다).
  //
  // 라운드가 끝난 것과 세션이 끝난 것은 다르다. state 는 **항상** 넘기고,
  // ended_at 은 세션을 정말 닫을 때만 찍는다.
  try {
    const sessionUpdate: Record<string, unknown> = {
      state: "ROUND_RESULT",
      updated_at: nowStr,
    };
    if (endSession) sessionUpdate.ended_at = nowStr;

    // error 를 안 보면 STOP 의 종료 갱신 실패가 조용히 성공으로 지나간다
    // (리뷰 지적, 2026-08-20). endSession 인 경우 특히 "끝난 척" 이 된다.
    const { error } = await db
      .from("nonsense_game_sessions")
      .update(sessionUpdate)
      .eq("id", sessionId)
      .eq("child_id", childId);
    if (error) {
      throw new Error(`넌센스 라운드 마감 실패: ${error.message}`);
    }
  } catch (err) {
    console.error("[finishQuestionRound] session update error:", err);
    throw err;
  }
}

/**
 * 세션 종료 (중단, 주제 전환, 오류 등, §3-13).
 */
export async function endNonsenseSession(
  db: SupabaseClient,
  sessionId: string,
  childId: string,
  reason: string = "STOP"
): Promise<void> {
  const nowStr = new Date().toISOString();

  try {
    // 예전에는 error 를 아예 보지 않았다. 종료가 실패해도 조용히 성공으로 지나가
    // 아이가 "그만" 했는데 다음 턴에 넌센스가 되살아났다(리뷰 지적, 2026-08-20).
    const { error } = await db
      .from("nonsense_game_sessions")
      .update({
        state: "ENDED",
        ended_at: nowStr,
        updated_at: nowStr,
      })
      .eq("id", sessionId)
      .eq("child_id", childId);
    if (error) {
      throw new Error(`넌센스 세션 종료 실패: ${error.message}`);
    }
  } catch (err) {
    console.error("[endNonsenseSession] session update error:", err);
    throw err;
  }

  // 아직 PRESENTED 상태로 남아있는 history는 reason에 따라 SKIPPED 또는 TOPIC_SHIFT로 정리
  const targetOutcome: NonsenseHistoryOutcome =
    reason === "TOPIC_SHIFT" || reason === "SAFETY_OR_NEGATIVE_EMOTION"
      ? "TOPIC_SHIFT"
      : "SKIPPED";

  try {
    await db
      .from("nonsense_question_history")
      .update({
        outcome: targetOutcome,
        updated_at: nowStr,
      })
      .eq("game_session_id", sessionId)
      .eq("child_id", childId)
      .eq("outcome", "PRESENTED");
  } catch (err) {
    console.error("[endNonsenseSession] history cleanup error:", err);
  }
}
