import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlaySkillModule,
  PlaySkillStartInput,
  PlaySkillTurnInput,
  PlaySkillEndInput,
  PlaySkillTurnResult,
} from "../play/skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import {
  startWordChainSession,
  getActiveWordChainSession,
  recordWordChainTurn,
  endWordChainSession,
  getRequiredStartSyllable,
} from "./sessionManager";
import { judgeChildWord, type WordChainRejection } from "./chainRules";
import { selectKNextWord } from "./nextWordSelector";
import { lookupWord, WORD_CHAIN_DICTIONARY, BY_FIRST_SYLLABLE } from "./dictionaryIndex";
import { allowedNextInitials } from "./dueum";
import { resolveGradePersona } from "../gradePersonas";
import {
  DerivedWordChainEntry,
  deriveWordChainEntry,
} from "./dictionaryTypes";

/**
 * 학년별 끝말잇기 K 단어 난이도 설정 (§3-19).
 * 아동 입력에는 난이도 제한을 두지 않고, K가 선택하는 단어에만 기준을 적용합니다.
 */
export const WORD_CHAIN_GRADE_DIFFICULTY: Record<
  number,
  { min: number; max: number }
> = {
  1: { min: 1, max: 2 },
  2: { min: 1, max: 3 },
  3: { min: 2, max: 4 },
  4: { min: 2, max: 5 },
  5: { min: 3, max: 5 },
  6: { min: 3, max: 6 },
};

/**
 * 학년 파라미터에서 K 단어 난이도 범위를 계산합니다.
 */
export function getWordChainGradeDifficulty(
  gradeRaw?: string | number | null
): { min: number; max: number } {
  const persona = resolveGradePersona(gradeRaw);
  const grade = persona?.grade ?? 3;
  return WORD_CHAIN_GRADE_DIFFICULTY[grade] ?? { min: 2, max: 4 };
}

/**
 * K의 첫 단어를 사전에서 결정론적으로 선택합니다 (§3-19).
 * - 학년별 난이도 범위 내 단어 중 아이가 이어갈 수 있는 후속 단어(Tier 3/2)가 풍부한 단어를 선택합니다.
 * - 첫 단어는 이어받을 이전 단어가 없으므로 selectKNextWord 대신 사전에서 직접 선택합니다.
 */
export function selectInitialKWord(
  minDifficulty: number,
  maxDifficulty: number,
  seed?: string
): DerivedWordChainEntry {
  const eligible = WORD_CHAIN_DICTIONARY.filter((entry) => {
    if (entry.difficulty < minDifficulty || entry.difficulty > maxDifficulty) {
      return false;
    }
    if (entry.normalizedWord.length < 2) return false;
    const followUps = BY_FIRST_SYLLABLE.get(entry.lastSyllable) ?? [];
    return followUps.length >= 3;
  });

  const pool =
    eligible.length > 0
      ? eligible
      : WORD_CHAIN_DICTIONARY.filter(
          (e) => e.difficulty >= minDifficulty && e.difficulty <= maxDifficulty
        );

  const fallback = pool.length > 0 ? pool : WORD_CHAIN_DICTIONARY;
  if (fallback.length === 0) {
    return deriveWordChainEntry({ word: "사과", difficulty: 1 });
  }

  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const idx = Math.abs(hash) % fallback.length;
    return fallback[idx];
  }

  return fallback[0];
}

/**
 * 끝말잇기 시작 직접 요청 패턴 및 부정/정의 제외 로직.
 */
const WORD_CHAIN_START_PATTERNS = [
  /(?:끝말\s*잇기|끝말잇기|말잇기|단어\s*잇기|단어잇기)/,
  /(?:끝말|단어)\s*이어\s*(?:가기|하기|달리기)/,
];

const WORD_CHAIN_START_NEGATION_KWS = [
  "안 해", "안해", "안 할", "안할", "싫어", "하기 싫", "하지 마", "하지마", "그만", "재미없", "안 놀",
];

const WORD_CHAIN_START_DEFINITION_KWS = [
  "뭐야", "뭔데", "무슨 뜻", "무슨 말", "어떤 뜻", "의미", "알아?", "알려줘", "규칙이 뭐야", "어떻게 하는",
];

export function detectWordChainStart(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  for (const neg of WORD_CHAIN_START_NEGATION_KWS) {
    if (trimmed.includes(neg)) return false;
  }
  for (const def of WORD_CHAIN_START_DEFINITION_KWS) {
    if (trimmed.includes(def)) return false;
  }

  return WORD_CHAIN_START_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * 명시적 게임 중단 발화 패턴.
 */
const EXPLICIT_STOP_PATTERNS = [
  /(?:끝말잇기|게임|놀이)?\s*(?:그만|안\s*할래|안해|그만하자|그만할래|끝낼래|안\s*놀래|하기\s*싫어|포기|항복|너\s*이겼어)/,
  /^(?:그만|그만해|끝|안해|안\s*해|싫어|포기|항복)$/,
];

function isExplicitStop(text: string): boolean {
  const trimmed = text.trim();
  return EXPLICIT_STOP_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * 주제 전환(Topic Shift) 및 비게임 대화 판단 (§3-22).
 * 아이가 게임 진행 중 감정/안전/일상 대화로 전환하면 게임 오답으로 처리하지 않고 일반 대화로 복귀합니다.
 */
const TOPIC_SHIFT_VERB_ENDINGS = [
  "했어", "했지", "했다", "할래", "먹었어", "갔어", "봤어", "인데", "거든", "잖아", "같아",
  "어때", "있어", "없어", "귀찮아", "힘들어", "몰라", "알아", "뭐해", "언제 가", "어디 가", "싸웠어"
];

function isTopicShift(text: string, signals: UtteranceSignals): boolean {
  // 1. 부정감정, 갈등, 신체적 불편 신호 감지 시 최우선 일반 대화 처리
  if (
    signals.hasNegativeEmotion ||
    signals.hasConflict ||
    signals.hasPhysicalNeed
  ) {
    return true;
  }

  const trimmed = text.trim();
  if (!trimmed) return false;

  // 2. 일반 지식/기억 회상 질문
  if (signals.hasGeneralKnowledgeQuestion || signals.hasMemoryRecallQuery) {
    return true;
  }

  // 3. 서술어/종결어미를 포함한 6자 이상의 일상 문장
  if (trimmed.includes(" ") && trimmed.length >= 6) {
    if (
      TOPIC_SHIFT_VERB_ENDINGS.some(
        (ending) => trimmed.endsWith(ending) || trimmed.includes(ending)
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 아이의 발화에서 단어 후보를 추출합니다.
 */
/**
 * 아이 발화에서 끝말잇기 낱말 후보를 뽑는다.
 *
 * 2026-08-18 23:56 Dev 실측(김서아): 아이가
 *   "아 진짜 한참 째 끝말잇기 하긴 하는 구나 귀찮냐 차표"
 * 라고 말했는데, 문장 전체를 낱말로 넘겨서 "차표" 가 통째로 유실됐다. 아이는 곧바로
 *   "내가 차표 라고 했잖아 왜 갑자기 메모지가 튀어 나오니"
 * 라고 지적했다. 아이는 말끝에 낱말을 붙여 말한다 — 문장이면 마지막 한글 낱말을 낱말로 본다.
 */
function extractChildCandidateWord(utterance: string): string {
  const trimmed = utterance.trim();
  const prefixMatch = trimmed.match(
    /^(?:정답은|정답이|정답|답은|답이|답|단어는|단어)\s*[:=!]?\s*([가-힣a-zA-Z0-9]+)/
  );
  if (prefixMatch && prefixMatch[1]) {
    return stripTrailingParticle(prefixMatch[1].trim());
  }

  const stripped = trimmed.replace(/^[!?.~^,]+|[!?.~^,]+$/g, "").trim();
  // 한 낱말이면 조사만 떼고 쓴다. ("기차야" 단답이 사전에 없다고 오답 처리되던 것 —
  // 2026-08-19 독립 리뷰 HIGH 지적)
  if (!/\s/.test(stripped)) return stripTrailingParticle(stripped);

  // 문장이면 마지막 한글 토큰을 낱말로 본다. 조사·감탄사만 남은 토큰은 건너뛴다.
  const tokens = stripped
    .split(/\s+/)
    .map((token) => token.replace(/[^가-힣a-zA-Z0-9]/g, ""))
    .filter((token) => token.length > 0);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.length >= 2 && /^[가-힣]+$/.test(token)) return stripTrailingParticle(token);
  }
  return tokens[tokens.length - 1] ?? stripped;
}

/**
 * "기차야", "사과요" 처럼 종결 조사가 붙은 낱말에서 조사를 뗀다.
 * 뗀 형태가 사전에 있을 때만 뗀다 — "고야", "비야" 같은 실제 낱말을 망치지 않기 위해서다.
 */
function stripTrailingParticle(token: string): string {
  for (const particle of ["이야", "야", "요", "이다"]) {
    if (!token.endsWith(particle)) continue;
    const base = token.slice(0, token.length - particle.length);
    if (base.length >= 2 && lookupWord(base)) return base;
  }
  return token;
}

/**
 * 거절 사유 5종에 따른 맞춤형 안내 지시문 생성.
 * - NOT_IN_DICTIONARY: 케이가 모르는 말이라고 하고 다시 기회를 줌 ("그런 말은 없어" 단정 금지)
 * - ALREADY_USED: 아까 나온 말이라고 알려줌
 * - CHAIN_MISMATCH: 어떤 글자로 시작해야 하는지 명확히 알려줌
 * - NOT_HANGUL / EMPTY: 다시 말해달라고 요청
 */
function buildRejectionInstruction(params: {
  rejection: WordChainRejection;
  targetWord: string;
  previousWord: string;
  requiredSyllable: string;
}): string {
  const { rejection, targetWord, previousWord, requiredSyllable } = params;

  switch (rejection) {
    case "NOT_IN_DICTIONARY":
      return `[끝말잇기] "${targetWord}"(은)는 케이가 아직 잘 모르는 단어야! 사전에 없는 단어니까 다른 단어로 다시 한번 말해줄래? "${requiredSyllable}"(으)로 시작하는 단어여야 해.`;
    case "ALREADY_USED":
      return `[끝말잇기] "${targetWord}"(은)는 아까 우리 게임에서 이미 나왔던 단어야! 이미 쓴 단어 말고 다른 단어로 다시 도전해볼래? "${requiredSyllable}"(으)로 시작해야 해.`;
    case "CHAIN_MISMATCH":
      return `[끝말잇기] "${targetWord}"(은)는 글자가 이어지지 않아! 지금은 "${previousWord}"의 마지막 글자인 "${requiredSyllable}"(으)로 시작하는 단어를 말해야 해. 다시 해보자!`;
    case "NOT_HANGUL":
      return `[끝말잇기] 한글 단어로 말해줘! "${requiredSyllable}"(으)로 시작하는 단어를 다시 한번 말해볼래?`;
    case "EMPTY":
    default:
      return `[끝말잇기] 어떤 단어인지 잘 못 들었어. "${requiredSyllable}"(으)로 시작하는 단어를 다시 말해줄래?`;
  }
}

/**
 * 끝말잇기(WORD_CHAIN) PlaySkill 어댑터 모듈.
 *
 * [주제 전환 및 안전 우선 처리 정책 (§3-22, §3-24)]
 * - 아이가 감정 표현("친구랑 싸웠어", "속상해"), 신체 불편, 안전 이슈 또는 일상 대화로 주제를 전환하면
 *   게임을 오답 처리하지 않고 active 세션을 종료(ENDED) 처리한 후 { handled: false }를 반환합니다.
 * - 세션을 ENDED로 종료하는 이유:
 *   1) 아이의 관심과 감정이 이미 게임을 벗어났으므로 세션을 깔끔히 종료하여 향후 일반 대화 턴이
 *      stale game session에 의해 가로채지거나 오작동하지 않도록 방지합니다.
 *   2) 이후 아이가 다시 "끝말잇기 하자"고 요청할 때 깨끗한 새 판을 시작할 수 있습니다.
 */
export const WORD_CHAIN_SKILL: PlaySkillModule = {
  id: "WORD_CHAIN",
  displayName: "끝말잇기",
  childFacingDescription: "앞 말의 끝 글자로 이어서 말하는 놀이",
  proposal: {
    label: "끝말잇기",
    shortDescription: "마지막 글자로 이어지는 단어를 번갈아 말하는 놀이",
  },

  matchesDirectRequest(signals: UtteranceSignals, utterance: string): boolean {
    if (signals?.hasWordChainGameStart) return true;
    return detectWordChainStart(utterance);
  },

  async getActiveSession(
    db: SupabaseClient,
    childId: string
  ): Promise<{ id: string; updatedAt?: string | null; startedAt?: string | null } | null> {
    if (!db || !childId) return null;
    try {
      const session = await getActiveWordChainSession(db, childId);
      return session
        ? {
            id: session.id,
            updatedAt: session.updated_at,
            startedAt: session.started_at,
          }
        : null;
    } catch (err) {
      console.error("[wordChainSkill] getActiveSession error:", err);
      return null;
    }
  },

  async start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult> {
    try {
      const { db, childId, chatSessionId, gradeRaw } = input;
      if (!db || !childId || !chatSessionId) {
        return { handled: false };
      }

      // 1. 활성 세션이 이미 존재하는지 확인 -> 중복 생성 방지 및 기존 세션 이어받기 (§3-7)
      const existingSession = await getActiveWordChainSession(db, childId);
      if (existingSession && existingSession.current_word) {
        const reqSyllable =
          getRequiredStartSyllable(existingSession) ??
          existingSession.current_word.slice(-1);
        const openingLine = `우리 아까 하던 거 이어서 하자! "${existingSession.current_word}" 다음으로 "${reqSyllable}"(으)로 시작해줘!`;
        return {
          handled: true,
          instruction: `[끝말잇기] 이미 진행 중인 끝말잇기 게임이 있어! 지금 단어는 "${existingSession.current_word}"야. "${reqSyllable}"(으)로 시작하는 단어를 말해줘.`,
          ended: false,
          openingLine,
          requiredWordInOutput: existingSession.current_word,
        };
      }

      // 2. 학년 난이도 산출 및 K의 첫 단어 결정론적 선택 (§3-19)
      const diffRange = getWordChainGradeDifficulty(gradeRaw);
      const persona = resolveGradePersona(gradeRaw);
      const initialDifficulty = persona?.chosungGame?.baseDifficulty ?? diffRange.min;
      const initialWordEntry = selectInitialKWord(
        diffRange.min,
        diffRange.max,
        chatSessionId
      );

      // 3. 신규 세션 생성 (DB)
      await startWordChainSession(db, {
        childId,
        chatSessionId,
        gradeRaw,
        initiatedBy: "K",
        initialWord: initialWordEntry.word,
        initialDifficulty,
      });

      // 4. K가 낸 첫 단어를 포함하는 instruction 생성
      const reqSyllable = initialWordEntry.lastSyllable;
      const openingLine = `좋아, 끝말잇기 하자! 내가 먼저 할게. ${initialWordEntry.word}!`;
      return {
        handled: true,
        instruction: `[끝말잇기] 케이가 먼저 시작할게! 첫 번째 단어는 "${initialWordEntry.word}"야. "${reqSyllable}"(으)로 시작하는 단어를 이어 말해줘.`,
        ended: false,
        openingLine,
        requiredWordInOutput: initialWordEntry.word,
      };
    } catch (err) {
      console.error("[wordChainSkill] start error:", err);
      return { handled: false };
    }
  },

  async handleTurn(input: PlaySkillTurnInput): Promise<PlaySkillTurnResult> {
    try {
      const { db, childId, utterance, signals, gradeRaw } = input;
      if (!db || !childId) {
        return { handled: false };
      }

      // 1. 활성 세션 조회
      const activeSession = await getActiveWordChainSession(db, childId);
      if (!activeSession) {
        return { handled: false };
      }

      // 2. 안전/감정/명시적 중단/주제 전환 프리플라이트 (§3-22, §5)
      if (isExplicitStop(utterance)) {
        await endWordChainSession(db, activeSession.id, childId);
        return {
          handled: true,
          instruction: `[끝말잇기] 아이가 끝말잇기를 그만하자고 했어. 아쉬워하지 말고 즐겁게 잘 놀았다고 다정하게 칭찬하며 일반 대화로 돌아가.`,
          ended: true,
        };
      }

      if (isTopicShift(utterance, signals)) {
        // 주제 전환은 오답으로 처리하지 않고 세션을 종료하여 일반 대화로 안전하게 인계합니다.
        await endWordChainSession(db, activeSession.id, childId);
        return { handled: false };
      }

      // 3. 아이 발화에서 단어 추출 및 결정론적 판정 (§3-17)
      const targetWord = extractChildCandidateWord(utterance);
      const currentWordStr = activeSession.current_word ?? "";
      const prevEntry = currentWordStr
        ? lookupWord(currentWordStr) ??
          deriveWordChainEntry({ word: currentWordStr, difficulty: 1 })
        : null;
      const usedWordsSet = new Set<string>(activeSession.used_words ?? []);

      const judgement = judgeChildWord({
        raw: targetWord,
        previousWord: prevEntry,
        usedWords: usedWordsSet,
      });

      const requiredSyllable = prevEntry ? prevEntry.lastSyllable : "";

      // 4. 거절 처리 (ACCEPTED 아님)
      if (!judgement.accepted) {
        const rejection = judgement.rejection ?? "NOT_IN_DICTIONARY";

        // 거절 라운드 기록
        await recordWordChainTurn(db, {
          sessionId: activeSession.id,
          childId,
          word: targetWord,
          by: "CHILD",
          result: rejection,
          difficulty: activeSession.current_difficulty,
          nextState: "CHILD_TURN",
        });

        let instruction = buildRejectionInstruction({
          rejection,
          targetWord,
          previousWord: currentWordStr,
          requiredSyllable,
        });

        // 3회 연속 실패/좌절 복구 (Frustration Recovery, §3-21)
        try {
          const { data: recentRounds } = await db
            .from("word_chain_game_rounds")
            .select("by, result")
            .eq("session_id", activeSession.id)
            .order("created_at", { ascending: false })
            .limit(3);

          if (recentRounds && Array.isArray(recentRounds)) {
            const childFails = recentRounds.filter(
              (r) => r.by === "CHILD" && r.result !== "ACCEPTED"
            );
            if (childFails.length >= 3) {
              // 힌트 카테고리 추출
              let hintCategory = "";
              for (const initial of allowedNextInitials(requiredSyllable)) {
                const candidates = BY_FIRST_SYLLABLE.get(initial) ?? [];
                const validCand = candidates.find(
                  (c) =>
                    !usedWordsSet.has(c.normalizedWord) &&
                    !usedWordsSet.has(c.word)
                );
                if (validCand?.category) {
                  hintCategory = `"${validCand.category}" 종류나 `;
                  break;
                }
              }

              instruction += ` 아이가 연속으로 어려워하고 있으니 따뜻하게 격려해주고, "${requiredSyllable}"(으)로 시작하는 ${hintCategory}쉬운 단어를 생각해볼 수 있도록 작은 힌트를 줘. 정답 단어를 직접 말하지는 마.`;
            }
          }
        } catch {
          // 힌트 쿼리 실패 시 기본 안내 유지
        }

        return {
          handled: true,
          instruction,
          ended: false,
        };
      }

      // 5. 단어 통과 (ACCEPTED) -> 아이 턴 기록
      const childEntry = judgement.entry!;
      const updatedSession = await recordWordChainTurn(db, {
        sessionId: activeSession.id,
        childId,
        word: childEntry.word,
        by: "CHILD",
        result: "ACCEPTED",
        difficulty: childEntry.difficulty,
        nextState: "K_TURN",
        currentSession: activeSession,
      });

      // 6. K의 다음 단어 결정론적 선택 (§3-17, §3-18)
      const diffRange = getWordChainGradeDifficulty(gradeRaw);
      const currentUsedWords = new Set<string>(
        updatedSession.used_words ?? []
      );
      currentUsedWords.add(childEntry.normalizedWord);
      currentUsedWords.add(childEntry.word);

      const kNextEntry = selectKNextWord({
        previousWord: childEntry,
        usedWords: currentUsedWords,
        minDifficulty: diffRange.min,
        maxDifficulty: diffRange.max,
      });

      // 7-A. K가 이어갈 단어가 없음 -> 아이 승리 마무리 (§3-17, §3-20)
      if (!kNextEntry) {
        await endWordChainSession(db, activeSession.id, childId);
        await recordWordChainTurn(db, {
          sessionId: activeSession.id,
          childId,
          word: "",
          by: "K",
          result: "GIVE_UP",
          difficulty: diffRange.min,
          nextState: "ENDED",
          currentSession: updatedSession,
        });

        return {
          handled: true,
          instruction: `[끝말잇기] 와, "${childEntry.word}" 다음으로 이어갈 말을 케이가 못 찾겠어! 이번 판은 아이가 이겼어! 대단하다고 신나고 기분 좋게 칭찬해주고, 멋진 승리를 축하해줘.`,
          ended: true,
        };
      }

      // 7-B. K가 정상 연결 -> K 턴 기록 및 instruction 생성
      await recordWordChainTurn(db, {
        sessionId: activeSession.id,
        childId,
        word: kNextEntry.word,
        by: "K",
        result: "ACCEPTED",
        difficulty: kNextEntry.difficulty,
        nextState: "CHILD_TURN",
        currentSession: updatedSession,
      });

      const nextReqSyllable = kNextEntry.lastSyllable;
      return {
        handled: true,
        instruction: `[끝말잇기] 아이가 "${childEntry.word}"(으)로 멋지게 이어줬어! 케이는 "${kNextEntry.word}"(으)로 받을게. 이제 "${nextReqSyllable}"(으)로 시작하는 단어를 말해줘.`,
        ended: false,
        requiredWordInOutput: kNextEntry.word,
      };
    } catch (err) {
      console.error("[wordChainSkill] handleTurn error:", err);
      return { handled: false };
    }
  },

  async end(input: PlaySkillEndInput): Promise<void> {
    try {
      if (!input.db || !input.childId) return;
      const active = await getActiveWordChainSession(input.db, input.childId);
      if (active) {
        await endWordChainSession(input.db, active.id, input.childId);
      }
    } catch (err) {
      console.error("[wordChainSkill] end error:", err);
    }
  },
};

/** 테스트 전용 노출 — 문장 속 낱말 추출 규칙을 직접 검증한다(요청서 014). */
export const extractChildCandidateWordForTest = extractChildCandidateWord;
