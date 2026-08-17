import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rescoreTranscript,
  type RescoreCandidate,
  type RescoreResult,
} from "./contextualRescoring";
import { allowedNextInitials } from "@/lib/k-conversation/wordChain/dueum";
import { BY_FIRST_SYLLABLE } from "@/lib/k-conversation/wordChain/dictionaryIndex";

/**
 * 재해석 지연 경고 임계값 (밀리초).
 *
 * 300ms 로 설정한 이유:
 *   STT 완료 후 LLM/음성 응답 전까지의 체감 지연 예산(latency budget) 중
 *   서버 재해석 레이어(DB 3개 쿼리 병렬 조회 + 자모 거리 계산)에 허용되는
 *   최대 목표 지연이다. 확정값이 아니라 관측 시작값이며, 이를 초과할 때만
 *   경고 로그를 남겨 지연 증가폭을 모니터링한다 (§3-6).
 */
const RESCORING_SLOW_MS = 300;

/**
 * 이 출처의 후보는 **문제의 정답**이다. 재해석에 쓰지 않는다.
 *
 * 왜 뺐나 (2026-08-17 리뷰 2회):
 *   아이가 "타자"라고 답했는데 정답 "사자"로 치환돼 맞힌 것으로 처리됐다.
 *   막으려고 규칙을 조였더니 이번엔 "송아치"(아이가 송아지라고 맞게 말했는데
 *   STT 가 흘린 것)까지 막혀 맞힌 걸 틀렸다고 처리했다.
 *
 * 두 경우는 형태가 같다 — 같은 길이, 초성 하나 차이다.
 *   "타자" → "사자"  (막아야 함: 아이가 실제로 타자라고 말했다)
 *   "송아치" → "송아지" (고쳐야 함: 송아치는 낱말이 아니다)
 * 구분하려면 "그게 실제 낱말인가"를 알아야 하는데, 가진 사전은 1,404단어뿐이라
 * 없다고 해서 낱말이 아니라고 단정할 수 없다.
 *
 * 못 고치는 쪽(맞혔는데 틀렸다고 처리)은 097 이전과 같은 상태다. 반면 잘못 고치는
 * 쪽(틀렸는데 맞았다고 처리)은 게임을 통째로 무의미하게 만든다. 그래서 뺀다.
 *
 * 되살리려면 신뢰할 수 있는 낱말 존재 판정이 먼저 필요하다.
 */
const EXCLUDED_CANDIDATE_SOURCES = new Set(["nonsense_quiz", "chosung_game"]);

/**
 * 재해석 전후에서 실제로 바뀐 어절 한 쌍을 찾는다.
 * 어절 개수가 다르거나 두 곳 이상 바뀌었으면 null 을 돌려 보수적으로 막는다.
 */
function findChangedToken(before: string, after: string): { before: string; after: string } | null {
  const b = before.trim().split(/\s+/);
  const a = after.trim().split(/\s+/);
  if (b.length !== a.length) return null;

  let found: { before: string; after: string } | null = null;
  for (let i = 0; i < b.length; i += 1) {
    if (b[i] === a[i]) continue;
    if (found) return null; // 두 군데 이상 바뀌었다 — 판단하지 않는다
    found = { before: b[i], after: a[i] };
  }
  return found;
}

/**
 * 정답 후보로 치환해도 안전한가.
 *
 * STT 가 실제로 망가뜨리는 방향은 둘이다.
 *  - 없는 음절을 끼워 넣는다: "소" → "오수". 걷어내는 건 복원이다.
 *  - 받침을 흘린다: "송아지" → "소아지". 되돌리는 건 복원이다.
 *
 * 반면 **길이가 같은데 초성·중성이 바뀌는 것**은 오인식이 아니라 다른 낱말이다.
 * "타자"·"감자"를 정답 "사자"로 바꾸면 아이가 못 맞힌 문제를 맞힌 것으로 만들어 준다
 * (2026-08-17 리뷰 실측). 그래서 그 방향만 막는다.
 */
function isSafeAnswerRestoration(before: string, after: string): boolean {
  const b = before.replace(/\s+/g, "");
  const a = after.replace(/\s+/g, "");
  if (!b || !a) return false;
  // STT 가 끼워 넣은 음절을 걷어내는 방향은 허용한다.
  if (a.length < b.length) return true;
  // 같은 길이면 받침 차이만 허용한다.
  return differsOnlyByJongseong(b, a);
}

/** 두 문자열이 음절 수가 같고 받침(종성)만 다른가. */
function differsOnlyByJongseong(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (x.length !== y.length || x.length === 0) return false;

  for (let i = 0; i < x.length; i += 1) {
    if (x[i] === y[i]) continue;
    const cx = x.charCodeAt(i) - 0xac00;
    const cy = y.charCodeAt(i) - 0xac00;
    // 한쪽이라도 완성형 한글이 아니면 받침 차이로 볼 수 없다.
    if (cx < 0 || cx > 11171 || cy < 0 || cy > 11171) return false;
    // 초성·중성이 같고 종성만 달라야 한다.
    if (Math.floor(cx / 28) !== Math.floor(cy / 28)) return false;
  }
  return true;
}

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

  // 097 §5-3 킬 스위치. 이 레이어는 아이가 한 말을 바꿔 쓰므로 즉시 끌 수단이 있어야 한다.
  // 미설정이 기본 ON 이다 — 이미 배포돼 동작 중이라 기본값을 OFF 로 두면 조용히 기능이 죽는다.
  // 끄려면 Vercel 환경변수에 STT_RESCORING_DISABLED=true 를 넣고 재배포한다.
  if (process.env.STT_RESCORING_DISABLED === "true") {
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

  const startedAt = Date.now();
  try {
    const candidates: RescoreCandidate[] = [];
    const seenTexts = new Set<string>();

    const addCandidate = (text: string | null | undefined, source: string) => {
      if (!text || typeof text !== "string") return;
      // 정답 후보는 아예 담지 않는다. 담아두고 나중에 거르면 규칙이 갈라져 관리가 안 된다.
      if (EXCLUDED_CANDIDATE_SOURCES.has(source)) return;
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
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > RESCORING_SLOW_MS) {
        console.warn("[stt/serverRescoring] 재해석 지연", { elapsedMs, childId, changed: false });
      }
      return { text: original, raw: original, changed: false };
    }

    // 발음 유사도 기반 결정론적 재해석 수행
    const rescoreResult: RescoreResult = rescoreTranscript(original, candidates);
    if (!rescoreResult.changed) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > RESCORING_SLOW_MS) {
        console.warn("[stt/serverRescoring] 재해석 지연", { elapsedMs, childId, changed: false });
      }
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

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > RESCORING_SLOW_MS) {
      console.warn("[stt/serverRescoring] 재해석 지연", { elapsedMs, childId, changed: true });
    }

    return {
      text: rescoreResult.text,
      raw: original,
      changed: true,
      matchedCandidate: rescoreResult.matchedCandidate,
      score: rescoreResult.score,
      candidateSource: matchedSource,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > RESCORING_SLOW_MS) {
      console.warn("[stt/serverRescoring] 재해석 지연", { elapsedMs, childId, changed: false });
    }
    // 예외 발생 시 원문으로 안전하게 진행 (§3-6)
    console.error("[resolveChildUtterance] candidate collection failed (fallback to raw):", err);
    return { text: original, raw: original, changed: false };
  }
}
