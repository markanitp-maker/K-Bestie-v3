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
  getRecentInitialKWords,
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
 *
 * 010 §3-4 — seed 는 chatSessionId 다. 그것만 쓰면 같은 대화 세션에서 끝말잇기를 다시
 * 시작할 때마다 **항상 같은 첫 단어**가 나온다(2026-08-19 실측: "바나나우유"·"김치찌개" 반복).
 * 그래서 이미 써 본 첫 단어를 후보에서 뺀다. 무작위로 바꾸지 않는 이유는 결정론이
 * 재시도 안전성을 주기 때문이다 — 같은 턴을 두 번 처리해도 같은 단어가 나와야 한다.
 * 제외 목록이 게임마다 커지므로 결정론을 유지하면서도 단어가 달라진다.
 */
export function selectInitialKWord(
  minDifficulty: number,
  maxDifficulty: number,
  seed?: string,
  excludeWords: readonly string[] = []
): DerivedWordChainEntry {
  // 010 대표님 QA(2026-08-20 00:10) — 케이가 첫 단어로 "김치전" 을 냈고 아이가
  // "전기" 를 냈는데 거절당했다. 아이는 "단어도 몰라? 개판이네" 라고 했다.
  //
  // 원인이 둘이었다:
  //   1) 이어갈 단어를 셀 때 `BY_FIRST_SYLLABLE.get(lastSyllable)` 만 봤다 —
  //      두음법칙 대체 초성(예: 락 → 낙)을 빼먹어 실제보다 적게 센다.
  //   2) 임계값이 3이었다. '전' 으로 시작하는 사전 단어는 4개(전화·전화기·전선·전등)라
  //      통과했지만, 아이가 자연스럽게 떠올리는 말(전기·전구·전철)은 그 4개에 없다.
  //      후보가 몇 개뿐인 음절로 넘기면 아이 말이 계속 거절당한다.
  //
  // 그래서 두음법칙을 반영해 세고, **아이 학년에 맞는** 후속 단어 수로 문턱을 둔다.
  // 문턱을 못 넘으면 단계적으로 낮춘다 — 시작 단어를 못 고르는 것이 더 나쁘다.
  const countFollowUps = (entry: DerivedWordChainEntry, gradeOnly: boolean): number => {
    let count = 0;
    for (const initial of allowedNextInitials(entry.lastSyllable)) {
      for (const followUp of BY_FIRST_SYLLABLE.get(initial) ?? []) {
        if (followUp.normalizedWord === entry.normalizedWord) continue;
        if (gradeOnly && (followUp.difficulty < minDifficulty || followUp.difficulty > maxDifficulty)) {
          continue;
        }
        count += 1;
      }
    }
    return count;
  };

  const inGrade = WORD_CHAIN_DICTIONARY.filter(
    (entry) =>
      entry.difficulty >= minDifficulty &&
      entry.difficulty <= maxDifficulty &&
      entry.normalizedWord.length >= 2
  );

  // 넉넉한 순서로 시도한다: 학년 맞춤 6개 이상 → 학년 맞춤 3개 이상 → 사전 전체 3개 이상.
  const pool =
    inGrade.filter((entry) => countFollowUps(entry, true) >= 6).length > 0
      ? inGrade.filter((entry) => countFollowUps(entry, true) >= 6)
      : inGrade.filter((entry) => countFollowUps(entry, true) >= 3).length > 0
        ? inGrade.filter((entry) => countFollowUps(entry, true) >= 3)
        : inGrade.filter((entry) => countFollowUps(entry, false) >= 3).length > 0
          ? inGrade.filter((entry) => countFollowUps(entry, false) >= 3)
          : inGrade;

  // 이미 첫 단어로 써 본 낱말을 뺀다. 전부 빠져 후보가 0이 되면 제외를 포기한다 —
  // 단어가 겹치는 것이 게임을 못 하는 것보다 낫다.
  const excluded = new Set(excludeWords);
  const unused = pool.filter((entry) => !excluded.has(entry.normalizedWord));
  const usablePool = unused.length > 0 ? unused : pool;

  const fallback = usablePool.length > 0 ? usablePool : WORD_CHAIN_DICTIONARY;
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

/**
 * 지금 하는 말이 "놀이에 대한 말"인지(010, 018).
 *
 * 2026-08-19 16:10~16:24 대표님 QA 에서 드러난 구조적 결함의 핵심이다.
 * isTopicShift 는 "잖아/인데/알아/몰라" 가 들어간 6자 이상 문장을 화제 전환으로 보고
 * **끝말잇기 세션을 종료**했다. 그런데 아이가 케이를 지적할 때 쓰는 말이 정확히 그 모양이다:
 *   "게임이 안 끝났잖아 끝말잇기가"
 *   "아니 이빨 이잖아 빨 그럼 빨로 시작하는 글자를 해야지"
 * 그래서 아이가 규칙을 알려줄 때마다 게임이 죽고, 그 뒤 케이는 세션 없이 LLM 으로
 * 게임을 흉내냈다("무스탕 할게", "육교 할 차례인가?", "끝말잇기를 그런 식으로 하는 거야?").
 * 로그의 이상한 응답 대부분이 여기서 나왔다.
 *
 * 놀이 얘기를 하는 중이면 화제가 바뀐 게 아니다. 그만하자는 말은 별도 신호가 이미 잡는다.
 */
const PLAY_CONTEXT_MARKERS: readonly RegExp[] = [
  /끝말\s*잇기|끝말잇기|말잇기/,
  /초성/,
  /넌센스|수수께끼|퀴즈/,
  /게임|놀이/,
  /단어|낱말|글자/,
  // "답" 을 한 글자로 두면 "답답해", "대답", "답장" 까지 놀이 얘기로 본다.
  // 아이가 답답하다고 하는 건 놀이 얘기가 아니라 그만하고 싶다는 신호에 가깝다
  // — 그 말이 화제 전환에서 빠지면 좌절한 아이한테 게임 턴을 계속 요구하게 된다.
  // (2026-08-19 리뷰 지적) 놀이에서 답을 가리키는 형태만 남긴다.
  /정답|오답|답\s*(?:이야|이지|이지\?|은|을|이 |알려|말해|맞)/,
  /차례|순서|규칙/,
  /힌트/,
  // "이어" 도 한 글자 묶음으로 두면 "이어폰" 이 걸린다. 이어가라는 뜻일 때만 잡는다.
  /이어\s*(?:서|야|자|줘|봐|가|질|져)/,
  // 맞았는지 틀렸는지를 따지는 말도 놀이 안의 대화다.
  // "주걱 이라고 했잖아 그럼 주걱에 대해서 맞는지 안 맞는지를 알려줘야 될 거 아냐"
  /맞는지|맞았|맞췄|틀렸|틀린|맞아\?/,
];

/**
 * 010 §3-8 — 아이가 "놀이 방법부터 배우라" 고 요구하는 메타 불만.
 *
 * §3-8 실측 사례:
 *   아이: "어떻게 놀이를 하면 되는지부터 학습하고..."
 * 이 말에는 "놀이" 가 들어 있어서 mentionsPlayContext 가 true 가 되고, 그래서 화제 전환이
 * 아니라고 판정돼 **낱말 시도로 처리됐다**(2026-08-19 Dev QA 실측: 케이가 "학습하고" 는
 * 모르는 단어라고 답했다). §3-8 은 그 반대를 요구한다 — 게임 진행을 멈추고 짧게 인정한 뒤
 * 아이가 다시 명시적으로 요청할 때까지 자동 재개하지 않는다.
 *
 * [게임 안의 정정과 구분한다]
 * 아이가 규칙을 고쳐 주는 말은 게임을 살려 둬야 한다(018 에서 고친 그 문제다):
 *   "이빨 이잖아 빨 그럼 빨로 시작하는 글자를 해야지"        → 게임 유지
 *   "팔꿈치냐 팔꿈치지 ... 넌 끝말잇기 하는 방법을 기초도 모르냐" → 게임 유지(정정이 목적)
 * 그래서 "방법", "기초" 같은 낱말만으로 잡지 않는다. **먼저 배우라고 요구하는 형태**만 잡는다.
 */
const PLAY_LEARN_FIRST_COMPLAINT_PATTERNS: readonly RegExp[] = [
  /학습(?:하고|해|하라|부터)/,
  /먼저\s*(?:배우|익히|공부)/,
  /방법(?:부터|을\s*먼저)/,
  /규칙(?:부터|을\s*먼저)/,
];

/** 놀이 진행을 멈추고 인정해야 하는 메타 불만인지(§3-8). */
export function mentionsPlayLearnFirstComplaint(text: string): boolean {
  return PLAY_LEARN_FIRST_COMPLAINT_PATTERNS.some((pattern) => pattern.test(text));
}

export function mentionsPlayContext(text: string): boolean {
  return PLAY_CONTEXT_MARKERS.some((pattern) => pattern.test(text));
}

function isTopicShift(text: string, signals: UtteranceSignals): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 010 §3-8 — "놀이 방법부터 배우라" 는 요구는 게임 안의 대화가 아니다.
  // 놀이 문맥 검사보다 먼저 본다. 안 그러면 "놀이" 라는 낱말 때문에 게임 안 대화로
  // 처리돼 낱말 시도로 채점된다(2026-08-19 Dev QA 실측).
  if (mentionsPlayLearnFirstComplaint(trimmed)) return true;

  // 놀이에 대해 말하는 중이면 화제 전환이 아니다. 지적·불만도 놀이 안의 대화다.
  // 그만하자는 의사는 hasPlayStop / hasPlayRejection 이 따로 잡는다.
  if (mentionsPlayContext(trimmed)) return false;

  // 1. 부정감정, 갈등, 신체적 불편 신호 감지 시 최우선 일반 대화 처리
  //    (놀이 얘기가 아닌 경우에만 여기 도달한다)
  if (
    signals.hasNegativeEmotion ||
    signals.hasConflict ||
    signals.hasPhysicalNeed
  ) {
    return true;
  }

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
      // 010 §3-4 — 이미 첫 단어로 써 본 낱말은 뺀다. chatSessionId 시드만 쓰면
      // 같은 대화에서 다시 시작할 때마다 같은 단어가 나온다.
      const recentInitialWords = await getRecentInitialKWords(db, childId);
      const initialWordEntry = selectInitialKWord(
        diffRange.min,
        diffRange.max,
        chatSessionId,
        recentInitialWords
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
        // 015 — 3인칭("케이가")으로 두면 케이가 자기 이름을 그대로 읽어 "케이이가 먼저
        // 시작할게"처럼 나온다(Dev QA 실측). 케이는 자기를 "내가"라고 부른다.
        instruction: `[끝말잇기] 내가 먼저 시작한다고 말하고 첫 번째 단어 "${initialWordEntry.word}"를 제시해. 아이에게 "${reqSyllable}"(으)로 시작하는 단어를 이어 말해달라고 해.`,
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
      const childTurnRecord = await recordWordChainTurn(db, {
        sessionId: activeSession.id,
        childId,
        word: childEntry.word,
        by: "CHILD",
        result: "ACCEPTED",
        difficulty: childEntry.difficulty,
        nextState: "K_TURN",
        currentSession: activeSession,
      });

      // 010 §3-14 — 상태가 DB 에 확정되지 않았으면 다음 단어를 만들지 않는다.
      //
      // 예전에는 실패해도 만들어진 상태를 그대로 받아 K 단어를 아이에게 말했다.
      // DB 에는 이전 current_word 가 남으니 다음 턴의 이어갈 글자가 어긋난다 —
      // "케이가 자기가 낸 단어를 잊는" 증상이 여기서 나왔다.
      // 상태 불일치를 퍼뜨리는 대신 이 턴만 짧게 사과하고 멈춘다.
      if (!childTurnRecord.persisted) {
        console.error("[wordChainSkill] 아이 턴 상태 확정 실패 — K 단어 생성을 중단한다", {
          childId,
          sessionId: activeSession.id,
        });
        return {
          handled: true,
          instruction:
            "[끝말잇기] 지금 기록이 잠깐 안 됐어. 아이에게 \"앗, 잠깐 문제가 생겼어. 조금 뒤에 다시 이어서 하자!\" 라는 뜻으로 짧고 다정하게 말해줘. 다음 단어나 이어갈 글자를 절대 말하지 마.",
          ended: false,
        };
      }
      const updatedSession = childTurnRecord.session;

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
      const kTurnRecord = await recordWordChainTurn(db, {
        sessionId: activeSession.id,
        childId,
        word: kNextEntry.word,
        by: "K",
        result: "ACCEPTED",
        difficulty: kNextEntry.difficulty,
        nextState: "CHILD_TURN",
        currentSession: updatedSession,
      });

      // 010 §3-14 — 여기가 가장 위험한 지점이다. K 단어가 저장되지 않았는데 아이에게
      // 말하면, 다음 턴에 DB 가 계산하는 이어갈 글자는 아이 단어 기준이 된다.
      // 그러면 케이가 방금 말한 단어를 스스로 부정하는 것처럼 보인다.
      if (!kTurnRecord.persisted) {
        console.error("[wordChainSkill] K 턴 상태 확정 실패 — 단어를 아이에게 말하지 않는다", {
          childId,
          sessionId: activeSession.id,
        });
        return {
          handled: true,
          instruction:
            "[끝말잇기] 지금 기록이 잠깐 안 됐어. 아이에게 \"앗, 잠깐 문제가 생겼어. 조금 뒤에 다시 이어서 하자!\" 라는 뜻으로 짧고 다정하게 말해줘. 다음 단어나 이어갈 글자를 절대 말하지 마.",
          ended: false,
        };
      }

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
