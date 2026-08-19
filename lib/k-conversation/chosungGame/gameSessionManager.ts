import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGradePersona, GRADE_PERSONAS } from "../gradePersonas";
import { isCorrectAnswer } from "./answerNormalize";
import { extractChosung } from "./chosungUtil";
import {
  WORD_POOL,
  getWordsByDifficulty,
  type ChosungWord,
  type ChosungCategory,
} from "./wordPool";
import {
  computeNextDifficulty,
  type RoundOutcome,
  type RoundResult,
} from "./adaptiveDifficulty";

export type SessionState =
  | "OFFERED"
  | "PLAYING_K_ASKS"
  | "PLAYING_CHILD_ASKS"
  | "WAITING_FOR_ANSWER"
  | "HINT"
  | "ROUND_RESULT"
  | "ENDED";

export type InitiatedBy = "CHILD" | "K";

export interface ChosungGameSessionRow {
  id: string;
  child_id: string;
  chat_session_id: string;
  state: SessionState;
  initiated_by: InitiatedBy;
  current_word: string | null;
  current_chosung: string | null;
  current_category: string | null;
  current_difficulty: number;
  hint_level: number;
  recent_words: string[];
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface ChosungGameRoundRow {
  id: string;
  session_id: string;
  child_id: string;
  game_type: string;
  difficulty: number;
  result: RoundResult;
  hint_used: number;
  initiated_by: InitiatedBy;
  created_at: string;
}

export interface StartSessionParams {
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  initiatedBy?: InitiatedBy;
  category?: ChosungCategory;
}

export interface SubmitAnswerParams {
  sessionId: string;
  childId: string;
  userAnswer?: string;
  roundResult?: RoundResult;
  gradeRaw?: string | number | null;
  hintUsed?: number;
}

export interface SubmitAnswerResult {
  isCorrect: boolean;
  roundResult: RoundResult;
  nextDifficulty: number;
  round: ChosungGameRoundRow;
  session: ChosungGameSessionRow;
}

export interface NextRoundParams {
  sessionId: string;
  childId: string;
  gradeRaw?: string | number | null;
  category?: ChosungCategory;
}

export interface EndSessionParams {
  sessionId: string;
  childId: string;
}

/**
 * 1. 게임 세션 시작
 * 아이 학년에 따른 기본 난이도와 단어를 설정하여 `chosung_game_sessions` 행을 생성합니다.
 */
/**
 * 이 아이가 최근 초성게임에서 이미 낸 낱말들(010 §3-4).
 *
 * 세션 안에서는 `recent_words` 가 중복을 막지만 새 세션은 이력을 보지 않는다.
 * 실패하면 빈 집합을 돌려준다 — 제외를 못 해도 게임은 되어야 한다.
 */
async function getRecentlyUsedChosungWords(
  db: SupabaseClient,
  childId: string,
  sessionLimit = 5
): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from("chosung_game_sessions")
      .select("recent_words")
      .eq("child_id", childId)
      .order("updated_at", { ascending: false })
      .limit(sessionLimit);
    if (error || !data) return new Set();
    return new Set(data.flatMap((row) => (row.recent_words as string[] | null) ?? []));
  } catch (error) {
    console.error("[chosungGame/gameSessionManager] 최근 사용 낱말 조회 실패", error);
    return new Set();
  }
}

export async function startChosungGameSession(
  db: SupabaseClient,
  params: StartSessionParams
): Promise<ChosungGameSessionRow> {
  const { childId, chatSessionId, gradeRaw, initiatedBy = "K", category } = params;

  const persona = resolveGradePersona(gradeRaw) ?? GRADE_PERSONAS[1];
  const baseDiff = persona.chosungGame.baseDifficulty;
  const minDiff = persona.chosungGame.minDifficulty;
  const maxDiff = persona.chosungGame.maxDifficulty;

  let candidateWords = getWordsByDifficulty(baseDiff, baseDiff, category);
  if (candidateWords.length === 0) {
    candidateWords = getWordsByDifficulty(minDiff, maxDiff, category);
  }
  if (candidateWords.length === 0) {
    candidateWords = [...WORD_POOL];
  }

  // 010 §3-4 — 세션 안에서는 recent_words 로 중복을 막지만, 새 세션은 그 이력을 보지 않아
  // 방금 끝낸 게임의 문제가 바로 다시 나올 수 있었다. 최근 세션들에서 낸 낱말을 뺀다.
  // 전부 빠지면 제외를 포기한다 — 겹치는 것이 문제를 못 내는 것보다 낫다.
  const recentlyUsed = await getRecentlyUsedChosungWords(db, childId);
  const unusedCandidates = candidateWords.filter((entry) => !recentlyUsed.has(entry.word));
  const pickPool = unusedCandidates.length > 0 ? unusedCandidates : candidateWords;

  const selectedWord = pickPool[Math.floor(Math.random() * pickPool.length)];
  const chosung = selectedWord.chosung || extractChosung(selectedWord.word);

  const initialState: SessionState =
    initiatedBy === "CHILD" ? "PLAYING_CHILD_ASKS" : "PLAYING_K_ASKS";

  const { data, error } = await db
    .from("chosung_game_sessions")
    .insert({
      child_id: childId,
      chat_session_id: chatSessionId,
      state: initialState,
      initiated_by: initiatedBy,
      current_word: selectedWord.word,
      current_chosung: chosung,
      current_category: selectedWord.category,
      current_difficulty: baseDiff,
      hint_level: 0,
      recent_words: [selectedWord.word],
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `[gameSessionManager] startChosungGameSession DB error: ${error?.message ?? "No data returned"}`
    );
  }

  return data as ChosungGameSessionRow;
}

/**
 * 2. 현재 활성 게임 세션 조회
 */
export async function getActiveChosungGameSession(
  db: SupabaseClient,
  childId: string
): Promise<ChosungGameSessionRow | null> {
  const { data, error } = await db
    .from("chosung_game_sessions")
    .select("*")
    .eq("child_id", childId)
    .is("ended_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[gameSessionManager] getActiveChosungGameSession DB error: ${error.message}`
    );
  }

  return data as ChosungGameSessionRow | null;
}

/**
 * 3. 답변 제출 및 라운드 처리
 * 정답 여부를 판정하고 `chosung_game_rounds`에 기록하며 적응형 난이도(학년 하한 보장)를 계산해 세션을 갱신합니다.
 */
export async function submitChosungAnswer(
  db: SupabaseClient,
  params: SubmitAnswerParams
): Promise<SubmitAnswerResult> {
  const {
    sessionId,
    childId,
    userAnswer,
    roundResult: explicitResult,
    gradeRaw,
    hintUsed = 0,
  } = params;

  const { data: sessionData, error: sessionErr } = await db
    .from("chosung_game_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("child_id", childId)
    .is("ended_at", null)
    .single();

  if (sessionErr || !sessionData) {
    throw new Error(
      `[gameSessionManager] submitChosungAnswer: active session not found. ${sessionErr?.message ?? ""}`
    );
  }

  const session = sessionData as ChosungGameSessionRow;

  let isCorrect = false;
  let finalResult: RoundResult;

  if (explicitResult) {
    finalResult = explicitResult;
    isCorrect = finalResult === "correct";
  } else {
    const currentWordStr = session.current_word ?? "";
    const poolEntry = WORD_POOL.find((w) => w.word === currentWordStr);
    const acceptedAnswers = poolEntry?.acceptedAnswers ?? [];

    isCorrect = userAnswer
      ? isCorrectAnswer(userAnswer, currentWordStr, acceptedAnswers)
      : false;
    finalResult = isCorrect ? "correct" : "skip";
  }

  const { data: roundData, error: roundErr } = await db
    .from("chosung_game_rounds")
    .insert({
      session_id: session.id,
      child_id: session.child_id,
      game_type: "CHOSUNG",
      difficulty: session.current_difficulty,
      result: finalResult,
      hint_used: hintUsed,
      initiated_by: session.initiated_by,
    })
    .select()
    .single();

  if (roundErr || !roundData) {
    throw new Error(
      `[gameSessionManager] submitChosungAnswer: failed to insert round record. ${roundErr?.message ?? ""}`
    );
  }

  const { data: recentRoundsData, error: recentErr } = await db
    .from("chosung_game_rounds")
    .select("result, hint_used")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (recentErr) {
    throw new Error(
      `[gameSessionManager] submitChosungAnswer: failed to fetch recent rounds. ${recentErr.message}`
    );
  }

  const recentOutcomes: RoundOutcome[] = (recentRoundsData || []).map((r) => ({
    result: r.result as RoundResult,
    hintUsed: r.hint_used,
  }));

  // gradeRaw가 없으면 1학년 페르소나로 떨어져 하한이 1이 된다. 그러면 3학년 아이가
  // 오답 몇 번에 1학년 난이도까지 밀린다(2026-08-16 실측: 하한 2인데 1로 하강).
  // 학년을 모르면 난이도를 낮추지 않는다 — 현재 난이도를 하한으로 삼아 방어한다.
  const persona = resolveGradePersona(gradeRaw);
  const minDifficulty = persona
    ? persona.chosungGame.minDifficulty
    : Math.max(session.current_difficulty, GRADE_PERSONAS[1].chosungGame.minDifficulty);
  const maxDifficulty = persona
    ? persona.chosungGame.maxDifficulty
    : Math.max(session.current_difficulty, GRADE_PERSONAS[1].chosungGame.maxDifficulty);

  const rawNextDifficulty = computeNextDifficulty({
    currentDifficulty: session.current_difficulty,
    minDifficulty,
    maxDifficulty,
    recentOutcomes,
  });

  const nextDifficulty = Math.min(
    Math.max(rawNextDifficulty, minDifficulty),
    maxDifficulty
  );

  const { data: updatedSessionData, error: updateErr } = await db
    .from("chosung_game_sessions")
    .update({
      current_difficulty: nextDifficulty,
      state: "ROUND_RESULT",
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select()
    .single();

  if (updateErr || !updatedSessionData) {
    throw new Error(
      `[gameSessionManager] submitChosungAnswer: failed to update session state. ${updateErr?.message ?? ""}`
    );
  }

  return {
    isCorrect,
    roundResult: finalResult,
    nextDifficulty,
    round: roundData as ChosungGameRoundRow,
    session: updatedSessionData as ChosungGameSessionRow,
  };
}

/**
 * 4. 다음 라운드 진행
 * 학년 난이도 보정 및 세션 내 단어 중복 방지(recent_words)를 적용하여 새 단어로 라운드를 진행합니다.
 */
export async function nextChosungRound(
  db: SupabaseClient,
  params: NextRoundParams
): Promise<ChosungGameSessionRow> {
  const { sessionId, childId, gradeRaw, category } = params;

  const { data: sessionData, error: sessionErr } = await db
    .from("chosung_game_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("child_id", childId)
    .is("ended_at", null)
    .single();

  if (sessionErr || !sessionData) {
    throw new Error(
      `[gameSessionManager] nextChosungRound: active session not found. ${sessionErr?.message ?? ""}`
    );
  }

  const session = sessionData as ChosungGameSessionRow;

  const persona = resolveGradePersona(gradeRaw) ?? GRADE_PERSONAS[1];
  const minDiff = persona.chosungGame.minDifficulty;
  const maxDiff = persona.chosungGame.maxDifficulty;
  const targetDifficulty = Math.min(
    Math.max(session.current_difficulty, minDiff),
    maxDiff
  );

  const recentWords = new Set(session.recent_words || []);
  if (session.current_word) {
    recentWords.add(session.current_word);
  }

  let candidates = WORD_POOL.filter(
    (w) =>
      w.difficulty === targetDifficulty &&
      !recentWords.has(w.word) &&
      (category === undefined || w.category === category)
  );

  if (candidates.length === 0) {
    candidates = WORD_POOL.filter(
      (w) =>
        w.difficulty >= minDiff &&
        w.difficulty <= maxDiff &&
        !recentWords.has(w.word) &&
        (category === undefined || w.category === category)
    );
  }

  if (candidates.length === 0) {
    candidates = WORD_POOL.filter(
      (w) =>
        w.difficulty >= minDiff &&
        w.difficulty <= maxDiff &&
        (category === undefined || w.category === category)
    );
  }

  if (candidates.length === 0) {
    candidates = [...WORD_POOL];
  }

  const nextWord = candidates[Math.floor(Math.random() * candidates.length)];
  const chosung = nextWord.chosung || extractChosung(nextWord.word);

  const updatedRecentWords = Array.from(recentWords);
  if (!updatedRecentWords.includes(nextWord.word)) {
    updatedRecentWords.push(nextWord.word);
  }

  const nextState: SessionState =
    session.initiated_by === "CHILD" ? "PLAYING_CHILD_ASKS" : "PLAYING_K_ASKS";

  const { data: updatedData, error: updateErr } = await db
    .from("chosung_game_sessions")
    .update({
      state: nextState,
      current_word: nextWord.word,
      current_chosung: chosung,
      current_category: nextWord.category,
      current_difficulty: targetDifficulty,
      hint_level: 0,
      recent_words: updatedRecentWords,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select()
    .single();

  if (updateErr || !updatedData) {
    throw new Error(
      `[gameSessionManager] nextChosungRound DB error: ${updateErr?.message ?? "No data returned"}`
    );
  }

  return updatedData as ChosungGameSessionRow;
}

/**
 * 5. 세션 종료
 */
export async function endChosungGameSession(
  db: SupabaseClient,
  params: EndSessionParams
): Promise<ChosungGameSessionRow> {
  const { sessionId, childId } = params;
  const nowStr = new Date().toISOString();

  const { data, error } = await db
    .from("chosung_game_sessions")
    .update({
      state: "ENDED",
      ended_at: nowStr,
      updated_at: nowStr,
    })
    .eq("id", sessionId)
    .eq("child_id", childId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `[gameSessionManager] endChosungGameSession DB error: ${error?.message ?? "No data returned"}`
    );
  }

  return data as ChosungGameSessionRow;
}

/**
 * 6. 힌트 레벨 갱신 유틸리티
 */
export async function updateChosungHintLevel(
  db: SupabaseClient,
  params: { sessionId: string; childId: string; hintLevel: number }
): Promise<ChosungGameSessionRow> {
  const { sessionId, childId, hintLevel } = params;

  const { data, error } = await db
    .from("chosung_game_sessions")
    .update({
      hint_level: hintLevel,
      state: "HINT",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("child_id", childId)
    .is("ended_at", null)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `[gameSessionManager] updateChosungHintLevel DB error: ${error?.message ?? "No data returned"}`
    );
  }

  return data as ChosungGameSessionRow;
}
