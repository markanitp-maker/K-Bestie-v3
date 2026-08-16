import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradePersona } from "../gradePersonas";
import { extractChosung } from "./chosungUtil";
import { pickPersonalizedCategory } from "./interestPersonalization";
import type { RoundOutcome, RoundResult } from "./adaptiveDifficulty";
import {
  CHOSUNG_CATEGORIES,
  getWordsByDifficulty,
  type ChosungCategory,
  type ChosungWord,
} from "./wordPool";

export type ChosungGameState =
  | "OFFERED"
  | "PLAYING_K_ASKS"
  | "PLAYING_CHILD_ASKS"
  | "WAITING_FOR_ANSWER"
  | "HINT"
  | "ROUND_RESULT"
  | "ENDED";

export type ChosungGameInitiator = "CHILD" | "K";

export interface ChosungGameSession {
  id: string;
  childId: string;
  chatSessionId: string;
  state: ChosungGameState;
  initiatedBy: ChosungGameInitiator;
  currentWord: string | null;
  currentChosung: string | null;
  currentCategory: ChosungCategory | null;
  currentDifficulty: number;
  hintLevel: number;
  recentWords: string[];
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface CreateSessionInput {
  childId: string;
  chatSessionId: string;
  state: ChosungGameState;
  initiatedBy: ChosungGameInitiator;
  currentDifficulty: number;
  currentChosung?: string | null;
}

export interface UpdateSessionPatch {
  state?: ChosungGameState;
  currentWord?: string | null;
  currentChosung?: string | null;
  currentCategory?: ChosungCategory | null;
  currentDifficulty?: number;
  hintLevel?: number;
  recentWords?: string[];
}

interface SessionRow {
  id: string;
  child_id: string;
  chat_session_id: string;
  state: ChosungGameState;
  initiated_by: ChosungGameInitiator;
  current_word: string | null;
  current_chosung: string | null;
  current_category: string | null;
  current_difficulty: number;
  hint_level: number;
  recent_words: string[] | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

const SESSION_COLUMNS = [
  "id",
  "child_id",
  "chat_session_id",
  "state",
  "initiated_by",
  "current_word",
  "current_chosung",
  "current_category",
  "current_difficulty",
  "hint_level",
  "recent_words",
  "started_at",
  "updated_at",
  "ended_at",
].join(",");

const isChosungCategory = (value: string | null): value is ChosungCategory =>
  value !== null && CHOSUNG_CATEGORIES.some((category) => category === value);

const toSession = (row: SessionRow): ChosungGameSession => ({
  id: row.id,
  childId: row.child_id,
  chatSessionId: row.chat_session_id,
  state: row.state,
  initiatedBy: row.initiated_by,
  currentWord: row.current_word,
  currentChosung: row.current_chosung,
  currentCategory: isChosungCategory(row.current_category) ? row.current_category : null,
  currentDifficulty: row.current_difficulty,
  hintLevel: row.hint_level,
  recentWords: Array.isArray(row.recent_words) ? row.recent_words : [],
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  endedAt: row.ended_at,
});

const throwQueryError = (operation: string, error: { message: string } | null): void => {
  if (!error) return;
  console.error(`[k-conversation/chosungGame/gameSession] ${operation} failed`, error.message);
  throw new Error(`${operation} failed: ${error.message}`);
};

export const getActiveSession = async (
  db: SupabaseClient,
  childId: string,
): Promise<ChosungGameSession | null> => {
  const { data, error } = await db
    .from("chosung_game_sessions")
    .select(SESSION_COLUMNS)
    .eq("child_id", childId)
    .is("ended_at", null)
    .maybeSingle<SessionRow>();
  throwQueryError("getActiveSession", error);
  return data ? toSession(data) : null;
};

export const createSession = async (
  db: SupabaseClient,
  input: CreateSessionInput,
): Promise<ChosungGameSession | null> => {
  const { data, error } = await db
    .from("chosung_game_sessions")
    .insert({
      child_id: input.childId,
      chat_session_id: input.chatSessionId,
      state: input.state,
      initiated_by: input.initiatedBy,
      current_difficulty: input.currentDifficulty,
      current_chosung: input.currentChosung ?? null,
    })
    .select(SESSION_COLUMNS)
    .maybeSingle<SessionRow>();
  throwQueryError("createSession", error);
  return data ? toSession(data) : null;
};

export const updateSession = async (
  db: SupabaseClient,
  session: ChosungGameSession,
  patch: UpdateSessionPatch,
): Promise<ChosungGameSession | null> => {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.state !== undefined) values.state = patch.state;
  if (patch.currentWord !== undefined) values.current_word = patch.currentWord;
  if (patch.currentChosung !== undefined) values.current_chosung = patch.currentChosung;
  if (patch.currentCategory !== undefined) values.current_category = patch.currentCategory;
  if (patch.currentDifficulty !== undefined) values.current_difficulty = patch.currentDifficulty;
  if (patch.hintLevel !== undefined) values.hint_level = patch.hintLevel;
  if (patch.recentWords !== undefined) values.recent_words = patch.recentWords;

  const { data, error } = await db
    .from("chosung_game_sessions")
    .update(values)
    .eq("id", session.id)
    .eq("child_id", session.childId)
    .is("ended_at", null)
    .select(SESSION_COLUMNS)
    .maybeSingle<SessionRow>();
  throwQueryError("updateSession", error);
  return data ? toSession(data) : null;
};

export const endSession = async (
  db: SupabaseClient,
  session: ChosungGameSession,
): Promise<ChosungGameSession | null> => {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("chosung_game_sessions")
    .update({ state: "ENDED", ended_at: now, updated_at: now })
    .eq("id", session.id)
    .eq("child_id", session.childId)
    .is("ended_at", null)
    .select(SESSION_COLUMNS)
    .maybeSingle<SessionRow>();
  throwQueryError("endSession", error);
  return data ? toSession(data) : null;
};

export const recordRound = async (
  db: SupabaseClient,
  session: ChosungGameSession,
  result: RoundResult,
  hintUsed: number,
): Promise<boolean> => {
  const { error } = await db.from("chosung_game_rounds").insert({
    session_id: session.id,
    child_id: session.childId,
    game_type: "CHOSUNG",
    difficulty: session.currentDifficulty,
    result,
    hint_used: Math.max(0, hintUsed),
    initiated_by: session.initiatedBy,
  });
  throwQueryError("recordRound", error);
  return true;
};

const isRoundResult = (value: string): value is RoundResult =>
  value === "correct" || value === "skip" || value === "revealed" || value === "child_asked";

export const selectRecentKAskedOutcomes = (
  outcomes: readonly RoundOutcome[],
  limit: number = 5,
): RoundOutcome[] => outcomes
  .filter((outcome) => outcome.result !== "child_asked")
  .slice(0, limit);

export const getRecentOutcomes = async (
  db: SupabaseClient,
  childId: string,
  limit: number = 5,
): Promise<RoundOutcome[]> => {
  const { data, error } = await db
    .from("chosung_game_rounds")
    .select("result, hint_used")
    .eq("child_id", childId)
    .order("created_at", { ascending: false })
    .limit(Math.max(12, limit));
  throwQueryError("getRecentOutcomes", error);
  if (!Array.isArray(data)) return [];
  return selectRecentKAskedOutcomes(data.flatMap((row) =>
    typeof row.result === "string" && isRoundResult(row.result)
      ? [{ result: row.result, hintUsed: typeof row.hint_used === "number" ? row.hint_used : 0 }]
      : []), limit);
};

export const clampDifficulty = (difficulty: number, min: number, max: number): number =>
  Math.min(Math.max(difficulty, min), max);

export interface SelectWordInput {
  difficulty: number;
  minDifficulty: number;
  maxDifficulty: number;
  category?: ChosungCategory;
  recentWords: readonly string[];
  random?: () => number;
}

export interface SelectedWordChoice {
  word: ChosungWord;
  resetRecentWords: boolean;
}

export const selectWordChoiceForSession = ({
  difficulty,
  minDifficulty,
  maxDifficulty,
  category,
  recentWords,
  random = Math.random,
}: SelectWordInput): SelectedWordChoice | null => {
  const clampedDifficulty = clampDifficulty(difficulty, minDifficulty, maxDifficulty);
  const recent = new Set(recentWords);
  const exactCategory = getWordsByDifficulty(clampedDifficulty, clampedDifficulty, category)
    .filter((word) => !recent.has(word.word));
  const exactAny = getWordsByDifficulty(clampedDifficulty, clampedDifficulty)
    .filter((word) => !recent.has(word.word));
  const rangeCategory = getWordsByDifficulty(minDifficulty, maxDifficulty, category)
    .filter((word) => !recent.has(word.word));
  const rangeAny = getWordsByDifficulty(minDifficulty, maxDifficulty)
    .filter((word) => !recent.has(word.word));
  const resetRangeCategory = getWordsByDifficulty(minDifficulty, maxDifficulty, category);
  const resetRangeAny = getWordsByDifficulty(minDifficulty, maxDifficulty);
  const groups = [exactCategory, exactAny, rangeCategory, rangeAny, resetRangeCategory, resetRangeAny];
  const groupIndex = groups.findIndex((words) => words.length > 0);
  const candidates = groupIndex >= 0 ? groups[groupIndex] : [];
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
  return { word: candidates[index], resetRecentWords: groupIndex >= 4 };
};

export const selectWordForSession = (input: SelectWordInput): ChosungWord | null =>
  selectWordChoiceForSession(input)?.word ?? null;

export const pickNextWord = async (
  db: SupabaseClient,
  childId: string,
  gradePersona: GradePersona,
  session: ChosungGameSession,
  random: () => number = Math.random,
): Promise<ChosungGameSession | null> => {
  const category = random() < 0.25
    ? await pickPersonalizedCategory(db, childId)
    : undefined;
  const choice = selectWordChoiceForSession({
    difficulty: session.currentDifficulty,
    minDifficulty: gradePersona.chosungGame.minDifficulty,
    maxDifficulty: gradePersona.chosungGame.maxDifficulty,
    category,
    recentWords: session.recentWords,
    random,
  });
  if (!choice) return null;
  const { word, resetRecentWords } = choice;

  return updateSession(db, session, {
    state: "WAITING_FOR_ANSWER",
    currentWord: word.word,
    currentChosung: extractChosung(word.word),
    currentCategory: word.category,
    currentDifficulty: word.difficulty,
    hintLevel: 0,
    recentWords: resetRecentWords
      ? [word.word]
      : [...session.recentWords, word.word].slice(-10),
  });
};
