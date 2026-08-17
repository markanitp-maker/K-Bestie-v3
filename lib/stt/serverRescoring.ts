import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rescoreTranscript,
  type RescoreCandidate,
  type RescoreResult,
} from "./contextualRescoring";
import { allowedNextInitials } from "@/lib/k-conversation/wordChain/dueum";
import { BY_FIRST_SYLLABLE } from "@/lib/k-conversation/wordChain/dictionaryIndex";

export interface ResolveChildUtteranceResult {
  text: string;
  raw: string;
  changed: boolean;
  matchedCandidate?: string;
  score?: number;
  candidateSource?: string;
}

/**
 * 아이의 발화(raw transcript)를 활성 놀이 세션(넌센스, 초성, 끝말잇기)의 어휘 문맥과 대조하여
 * 결정론적으로 재해석(rescoring)하는 서버 공용 헬퍼 (§3-1, §3-2, §3-3).
 *
 * [동작 원칙]
 * 1. 자유대화(free_chat) 모드일 때만 활성 놀이 세션 후보를 수집한다 (§3-2).
 * 2. 미션(mission) 모드에서는 게임 후보를 수집하지 않고 원문을 그대로 유지한다 (§3-3).
 * 3. DB 조회 실패/예외 발생 시 대화를 중단하지 않고 원문으로 graceful fallback한다 (§3-6).
 * 4. 재해석 성공 시 원문과 결과, 후보 출처를 console.info로 계측 로깅한다 (§3-6).
 */
export async function resolveChildUtterance(
  db: SupabaseClient | null | undefined,
  childId: string | null | undefined,
  chatSessionId: string | null | undefined,
  rawText: string | null | undefined,
  mode: "mission" | "free_chat" | "MISSION" | "FREE_CHAT" = "free_chat"
): Promise<ResolveChildUtteranceResult> {
  const original = rawText ?? "";
  if (!original || typeof original !== "string" || !original.trim()) {
    return { text: original, raw: original, changed: false };
  }

  if (!db || !childId) {
    return { text: original, raw: original, changed: false };
  }

  const normalizedMode = mode.toLowerCase();
  // 미션 모드에서는 게임 후보를 사용하지 않음 (§3-3)
  if (normalizedMode === "mission") {
    return { text: original, raw: original, changed: false };
  }

  try {
    const candidates: RescoreCandidate[] = [];
    const seenTexts = new Set<string>();

    const addCandidate = (text: string | null | undefined, source: string) => {
      if (!text || typeof text !== "string") return;
      const trimmed = text.trim();
      if (!trimmed || seenTexts.has(trimmed)) return;
      seenTexts.add(trimmed);
      candidates.push({ text: trimmed, source });
    };

    // 활성 놀이 세션 조회 (Promise.allSettled 비동기 병렬)
    const [nonsenseRes, chosungRes, wordChainRes] = await Promise.allSettled([
      db
        .from("nonsense_game_sessions")
        .select("current_question_id")
        .eq("child_id", childId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("chosung_game_sessions")
        .select("current_word")
        .eq("child_id", childId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("word_chain_game_sessions")
        .select("current_word")
        .eq("child_id", childId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // 1. 넌센스 퀴즈 후보 수집 (canonical_answer, accepted_answers)
    if (
      nonsenseRes.status === "fulfilled" &&
      nonsenseRes.value.data?.current_question_id
    ) {
      const qId = nonsenseRes.value.data.current_question_id;
      try {
        const { data: qData, error: qErr } = await db
          .from("nonsense_questions")
          .select("canonical_answer, accepted_answers")
          .eq("id", qId)
          .maybeSingle();

        if (!qErr && qData) {
          addCandidate(qData.canonical_answer, "nonsense_quiz");
          if (Array.isArray(qData.accepted_answers)) {
            for (const ans of qData.accepted_answers) {
              addCandidate(ans, "nonsense_quiz");
            }
          }
        }
      } catch (qFetchErr) {
        console.error("[resolveChildUtterance] nonsense_questions lookup error:", qFetchErr);
      }
    }

    // 2. 초성게임 후보 수집 (current_word)
    if (
      chosungRes.status === "fulfilled" &&
      chosungRes.value.data?.current_word
    ) {
      addCandidate(chosungRes.value.data.current_word, "chosung_game");
    }

    // 3. 끝말잇기 후보 수집 (이어야 할 시작 음절 사전 단어, 두음법칙 포함)
    if (
      wordChainRes.status === "fulfilled" &&
      wordChainRes.value.data?.current_word
    ) {
      const currentWord = wordChainRes.value.data.current_word.trim();
      if (currentWord) {
        const lastSyllable = currentWord.slice(-1);
        const initials = allowedNextInitials(lastSyllable);
        for (const initChar of initials) {
          const wordsForInitial = BY_FIRST_SYLLABLE.get(initChar);
          if (wordsForInitial) {
            for (const entry of wordsForInitial) {
              addCandidate(entry.word, "word_chain");
              if (entry.acceptedAliases && Array.isArray(entry.acceptedAliases)) {
                for (const alias of entry.acceptedAliases) {
                  addCandidate(alias, "word_chain");
                }
              }
            }
          }
        }
      }
    }

    // 후보가 없으면 원문 그대로 반환 (§3-4)
    if (candidates.length === 0) {
      return { text: original, raw: original, changed: false };
    }

    // 발음 유사도 기반 결정론적 재해석 수행
    const rescoreResult: RescoreResult = rescoreTranscript(original, candidates);
    if (!rescoreResult.changed) {
      return { text: original, raw: original, changed: false };
    }

    const matchedSource = candidates.find(
      (c) => c.text === rescoreResult.matchedCandidate
    )?.source;

    // 계측 로깅 (§3-6)
    console.info("[STT_REINTERPRETATION]", {
      childId,
      raw: original.length > 50 ? original.slice(0, 50) + "..." : original,
      reinterpreted:
        rescoreResult.text.length > 50
          ? rescoreResult.text.slice(0, 50) + "..."
          : rescoreResult.text,
      matchedCandidate: rescoreResult.matchedCandidate,
      candidateSource: matchedSource,
      score: rescoreResult.score,
    });

    return {
      text: rescoreResult.text,
      raw: original,
      changed: true,
      matchedCandidate: rescoreResult.matchedCandidate,
      score: rescoreResult.score,
      candidateSource: matchedSource,
    };
  } catch (err) {
    // 예외 발생 시 원문으로 안전하게 진행 (§3-6)
    console.error("[resolveChildUtterance] candidate collection failed (fallback to raw):", err);
    return { text: original, raw: original, changed: false };
  }
}
