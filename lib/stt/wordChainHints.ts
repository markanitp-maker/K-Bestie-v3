import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedNextInitials } from "@/lib/k-conversation/wordChain/dueum";
import { BY_FIRST_SYLLABLE } from "@/lib/k-conversation/wordChain/dictionaryIndex";
import {
  getActiveWordChainSession,
  getRequiredStartSyllable,
  WordChainSessionRow,
} from "@/lib/k-conversation/wordChain/sessionManager";
import {
  WORD_CHAIN_MAX_HINTS,
  WORD_CHAIN_LOOKUP_TIMEOUT_MS,
} from "./childSpeechHints";

export interface WordChainHintsResult {
  phrases: string[];
  total: number;
  trimmed: boolean;
}

/**
 * 주어진 시작 가능 음절 목록(두음법칙 변형 포함)에 대해
 * 끝말잇기 정적 사전에서 후보 낱말을 추출합니다.
 *
 * @param initialSyllables 허용되는 시작 음절 목록 (예: ['프'] 또는 ['리', '이'])
 * @param maxLimit 최대 힌트 단어 수 (기본 300개)
 */
export function extractWordChainHintsForSyllables(
  initialSyllables: readonly string[],
  maxLimit: number = WORD_CHAIN_MAX_HINTS
): WordChainHintsResult {
  if (!initialSyllables || initialSyllables.length === 0) {
    return { phrases: [], total: 0, trimmed: false };
  }

  const seen = new Set<string>();
  const phrases: string[] = [];

  for (const syllable of initialSyllables) {
    if (!syllable) continue;
    const entries = BY_FIRST_SYLLABLE.get(syllable);
    if (!entries) continue;

    for (const entry of entries) {
      const word = entry.word;
      if (word && !seen.has(word)) {
        seen.add(word);
        phrases.push(word);
      }
    }
  }

  const total = phrases.length;
  const trimmed = total > maxLimit;
  const finalPhrases = trimmed ? phrases.slice(0, maxLimit) : phrases;

  if (trimmed) {
    console.info(
      `[mission/stt] Word chain hints trimmed from ${total} to ${maxLimit}`,
      {
        total,
        used: finalPhrases.length,
        initialSyllables,
      }
    );
  } else if (finalPhrases.length > 0) {
    console.info(
      `[mission/stt] Word chain hints collected: ${finalPhrases.length}`,
      {
        total,
        initialSyllables,
      }
    );
  }

  return { phrases: finalPhrases, total, trimmed };
}

/**
 * 직전 단어의 끝 음절에 대해 두음법칙을 적용하여
 * 다음에 아이가 말할 수 있는 낱말 힌트 목록을 생성합니다.
 *
 * @param lastSyllable 직전 단어의 마지막 음절 (예: '샤프' -> '프', '오리' -> '리')
 * @param maxLimit 최대 힌트 수 (기본 300개)
 */
export function extractWordChainHintsFromSyllable(
  lastSyllable: string,
  maxLimit: number = WORD_CHAIN_MAX_HINTS
): WordChainHintsResult {
  if (!lastSyllable || typeof lastSyllable !== "string") {
    return { phrases: [], total: 0, trimmed: false };
  }

  const initials = allowedNextInitials(lastSyllable);
  return extractWordChainHintsForSyllables(initials, maxLimit);
}

/**
 * 활성 끝말잇기 세션 행으로부터 아이 차례에 필요한 STT 힌트 단어들을 추출합니다.
 */
export function getWordChainHintsForSession(
  session: WordChainSessionRow | null,
  maxLimit: number = WORD_CHAIN_MAX_HINTS
): string[] {
  // SUSPENDED 는 주제 전환 등으로 게임이 멈춘 상태다. 아이는 끝말잇기가 아닌
  // 다른 얘기를 하고 있으므로 낱말 300개를 boost 하면 일반 발화 인식이 나빠진다.
  //
  // K_TURN 은 배제하지 않는다. 게임이 살아 있는데 상태가 아직 안 넘어온 사이에
  // 아이가 말하는 경우가 있고, 그때 힌트가 빠지면 정작 필요한 순간에 못 알아듣는다.
  // 이 문제를 고치려고 넣은 힌트다.
  if (!session || session.state === "ENDED" || session.state === "SUSPENDED" || session.ended_at) {
    return [];
  }

  const reqSyllable = getRequiredStartSyllable(session);
  if (!reqSyllable) {
    return [];
  }

  const result = extractWordChainHintsFromSyllable(reqSyllable, maxLimit);
  return result.phrases;
}

/**
 * DB에서 활성 끝말잇기 세션을 조회하여 STT 힌트 단어 목록을 반환합니다.
 * - 타임아웃(기본 500ms) 및 실패 내성: 세션 조회 실패/지연 시 throw하지 않고 빈 배열을 반환합니다.
 * - 초성게임 및 넌센스퀴즈 세션은 절대 조회하거나 단어를 힌트로 주입하지 않습니다.
 */
export async function resolveWordChainHints(
  db: SupabaseClient,
  params: { sessionId?: string; childId?: string },
  timeoutMs: number = WORD_CHAIN_LOOKUP_TIMEOUT_MS
): Promise<string[]> {
  const { sessionId, childId } = params;
  if (!sessionId && !childId) {
    return [];
  }

  // 지금 이 대화 세션의 끝말잇기만 인정한다.
  //
  // childId 로 먼저 찾으면 **이전 대화에서 비정상 종료된**(ended_at 이 안 찍힌)
  // 끝말잇기가 걸린다. 그러면 끝말잇기를 하지도 않는 새 대화에 낱말 300개가
  // boost 되어 일반 발화 인식이 오히려 나빠진다.
  // sessionId 가 없을 때만 childId 로 넘어간다.
  const lookupPromise = (async (): Promise<WordChainSessionRow | null> => {
    if (sessionId) {
      const { data, error } = await db
        .from("word_chain_game_sessions")
        .select("*")
        .eq("chat_session_id", sessionId)
        .is("ended_at", null)
        .maybeSingle();

      if (error) {
        console.warn("[resolveWordChainHints] DB query error:", error.message);
        return null;
      }
      return data as WordChainSessionRow | null;
    }
    if (childId) {
      return getActiveWordChainSession(db, childId);
    }
    return null;
  })();

  // 타임아웃이 이겨도 타이머는 남는다. STT 는 아이 발화마다 도는 경로라
  // 매 요청에 타이머 하나씩 쌓이게 두면 안 된다.
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Word chain session lookup timed out (${timeoutMs}ms)`)),
      timeoutMs
    );
  });

  try {
    const activeSession = await Promise.race([lookupPromise, timeoutPromise]);
    return getWordChainHintsForSession(activeSession);
  } catch (err) {
    console.warn(
      "[resolveWordChainHints] Failed to retrieve word chain hints, falling back to default hints",
      {
        error: err instanceof Error ? err.message : String(err),
        sessionId,
        childId,
      }
    );
    return [];
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}
