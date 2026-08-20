import type { UtteranceSignals } from "../utteranceSignals";
import type { NonsenseQuestionRow } from "./nonsenseQuizTypes";
import { collectPlayAnswerCandidates } from "../play/answerCandidates";

export type ChildNonsenseIntent =
  | "STOP"
  | "TOPIC_SHIFT"
  | "REVEAL_ANSWER"
  | "REQUEST_HINT"
  | "NEXT_QUESTION"
  | "ANSWER_ATTEMPT";

/**
 * 넌센스 퀴즈 답변 텍스트 정규화.
 * 공백, 문장부호, 접두사("정답: "), 서술어/종결어미("~야", "~예요", "~인가")를 제거합니다.
 */
/** 종결어미 목록. 긴 것부터 시도한다. */
const PREDICATE_ENDINGS = [
  "인 것 같아",
  "인것같아",
  "인가요",
  "입니다",
  "이에요",
  "이야",
  "이다",
  "이지",
  "잖아",
  "인가",
  "인듯",
  "예요",
  "같아",
  "야",
] as const;

/** 한글 음절에 받침이 있는지. (가 = 0xAC00, 받침 28종 주기) */
function hasFinalConsonant(syllable: string): boolean {
  const code = syllable.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/**
 * 서술격 조사·종결어미를 하나 제거한다.
 *
 * "~이야"가 까다롭다. "달이야"는 달 + 이야(서술격조사)라 정답이 "달"이고,
 * "나이야"는 나이 + 야라서 정답이 "나이"다. 글자 수로는 못 가른다.
 *
 * 국어 규칙으로 가른다: 서술격조사 "이"는 **받침 있는 말** 뒤에만 붙는다.
 *   달(받침 ㄹ) + 이야  → "이"는 조사다      → "달"
 *   나(받침 없음) + 이야 → 그런 형태는 없다  → "이"는 낱말의 일부 → "나이"
 * 받침 없는 말 뒤에서는 "나야"처럼 "야"만 붙는다.
 *
 * 그 밖의 어미는 지우고 남는 말이 있으면 그대로 지운다.
 */
function stripPredicateEnding(word: string): string {
  for (const ending of PREDICATE_ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const remainder = word.slice(0, -ending.length);
    if (remainder.length === 0) continue;

    // "이"로 시작하는 서술격 어미는 앞말에 받침이 있을 때만 조사다.
    if (ending.startsWith("이") && ending !== "인가" && ending !== "인듯") {
      const base = remainder[remainder.length - 1];
      if (!hasFinalConsonant(base)) continue; // 조사가 아니다 — 더 짧은 어미를 시도한다.
    }
    return remainder;
  }
  return word;
}

export function normalizeNonsenseAnswer(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // 1. 접두사 제거 ("정답은", "답:", "혹시")
  cleaned = cleaned.replace(/^(?:정답(?:은|이)?|답(?:은|이)?|혹시)\s*[:=!]?\s*/, "");

  // 1-1. 아이 구어 접두사 제거 (015).
  //
  // 2026-08-19 김서아 Dev 로그에서 아이가 "너는 보드 게임"이라고 답했는데 정답으로
  // 인정되지 않았다. 아이는 답만 딱 말하지 않는다 — "그건", "내 생각엔", "아마" 같은
  // 말을 앞에 붙인다. 그걸 답의 일부로 보면 멀쩡한 정답이 오답이 된다.
  // 반복 적용한다: "아 그건 답은 보드게임" 처럼 겹쳐 나오는 경우가 있다.
  // 접두사 뒤에는 반드시 공백이 있어야 한다. 이게 없으면 "그림"의 "그"를 접두사로 보고
  // "림"만 남기는 사고가 난다(실측). 즉 답 자체가 접두사와 같은 글자로 시작해도 안전하다.
  const COLLOQUIAL_PREFIX =
    /^(?:내\s*생각(?:엔|에는|에)?|제\s*생각(?:엔|에는|에)?|내\s*답(?:은|이)?|그건|그거|그게|이건|이거|이게|너는|나는|저기|잠깐|혹시나|아마|답은|넌|난|음|어|아|그)\s*[:=!,]?\s+/;
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(COLLOQUIAL_PREFIX, "");
  } while (cleaned !== previous && cleaned.length > 0);

  // 2. 앞뒤 문장부호 및 특수문자 제거
  cleaned = cleaned.replace(/^[\s!?.~^,;:…]+|[\s!?.~^,;:…]+$/g, "");

  // 3. 서술격 조사 / 종결어미 제거
  //
  // 긴 어미부터 지우되, 지우고 남는 말이 1글자가 되면 한 단계 짧은 어미를 쓴다.
  // "나이야"에서 "이야"를 지우면 "나"가 되는데 정답은 "나이"다(015 실측).
  // 반대로 "달력이야"는 "이야"를 지워야 "달력"이 된다 — 남는 길이로 갈린다.
  cleaned = stripPredicateEnding(cleaned);

  // 4. 모든 내부 공백 제거 (넌센스 퀴즈는 띄어쓰기 차이로 오답 처리하지 않음)
  cleaned = cleaned.replace(/\s+/g, "");

  return cleaned.trim();
}

/** 명시적 게임 중단 발화 패턴 */
const EXPLICIT_STOP_PATTERNS = [
  /(?:넌센스|수수께끼|퀴즈|게임|놀이)?\s*(?:그만|안\s*할래|안해|그만하자|그만할래|그만해|끝낼래|안\s*놀래|하기\s*싫어)/,
  /^(?:그만|그만해|끝|안해|안\s*해|싫어|안\s*놀래)$/,
];

/** 다음 문제 요청 패턴 */
/**
 * 그 자체로 **아무 문제의 정답도 될 수 없는** 맨 긍정·수락 표현.
 *
 * "해", "하자", "할래", "가자", "고" 는 일부러 뺐다 — 리뷰 지적(2026-08-19).
 * 시드 문항에 정답이 `해`(태양)인 문제가 4개 있다(NQ0167·NQ0211·NQ0273·NQ0274, DB 실측).
 * 긍정으로 삼키면 아이가 정답을 맞혔는데 다음 문제로 넘어가 버린다.
 * 긍정 오탐(오답 처리)보다 정답 삼킴이 더 나쁘므로 애매한 토큰은 넣지 않는다.
 */
const BARE_AFFIRMATIVE_PATTERN =
  /^(?:ㅇㅇ|ㅇㅋ|ㄱㄱ|응+|웅+|넹|그래|그럼|좋아|조아|좋지|좋아요|당연|당연하지|콜|오케이|ok|okay)[!?.~^ㅋㅎ\s]*$/i;

const NEXT_QUESTION_PATTERNS = [
  /^(?:다음|또|하나\s*더|한\s*번\s*더|한번\s*더|계속|다음\s*문제|문제\s*더|더\s*해|더\s*할래|더\s*하자)$/,
  /(?:다음\s*문제|문제\s*또|문제\s*하나\s*더|새\s*문제|다른\s*문제|하나\s*더\s*내|또\s*내)/,
  /^(?:다음\s*다음\s*문제\s*또\s*내라고|다음\s*문제\s*내줘|다음\s*문제\s*줘|또\s*내봐|또\s*내줘|문제\s*내봐|문제\s*내줘)$/,
  // 010 — 위 패턴들은 문장 전체가 정확히 일치할 때만 걸린다. 아이는 앞에 말을 붙이고
  // ASR 은 "내봐" 를 "내 봐" 로 쪼갠다. 2026-08-19 대표님 QA 실측:
  //   "내 봐", "그래 문제 내봐" 가 다음 문제 요청으로 인식되지 않아 **힌트 요청으로 흘러갔고**,
  //   케이가 내지도 않은 문제에 "정답은 4글자 안팎이야", "첫 글자는 '스'로 시작해" 라고 답했다.
  /문제\s*(?:내|줘|주라|달)/,
  /^(?:내\s*봐|내\s*줘|내\s*주라|하나\s*내|하나\s*더)[!?.~^]*$/,
  // 2026-08-20 대표님 실사용 — "진행해" 가 인식되지 않아 다음 문제가 나가지 않았다.
  // 아이는 "계속하자" 를 여러 방식으로 말한다.
  /^(?:진행|진행해|진행해줘|계속해|계속\s*해|이어서|이어\s*해|고고|다시)[!?.~^\s]*$/,
  /^(?:그\s*다음|다음\s*거|넘어가|넘겨)[!?.~^\s]*$/,
];

/** 정답 바로 공개 / 포기 요청 패턴 */
const REVEAL_ANSWER_PATTERNS = [
  /(?:정답|답)\s*(?:알려줘|알려\s*줘|공개|뭐야|뭔데|말해줘|말해\s*줘|보여줘|알려줄래)/,
  /(?:모르겠어|몰라)\s*(?:정답|답)\s*(?:알려줘|뭐야|뭔데)/,
  /^(?:정답|답)$/,
  /^(?:포기|패스|항복|포기할래|항복할래|패스할래)$/,
];

/** 힌트 요청 키워드 및 부정어 */
const HINT_REQUEST_KWS = [
  "힌트", "모르겠", "몰라", "어려워", "어렵", "못 맞추겠", "못 맞히겠", "도저히 모르", "하나도 모르", "잘 모르",
  // 016 후속 대표님 실사용(2026-08-20 10:51) — 아이가 "모루겠어" 라고 했는데 힌트 요청으로
  // 안 걸려 넌센스 세션이 통째로 끊겼다("미안, 내가 착각했어. 초성게임이랑 끝말잇기 중에
  // 뭐 할래?"). 대표님: "게임 종료를 안 원했는데, 멋데로 또 종료하네!"
  // 아이는 키보드로 치고 음성인식도 거친다. 흔한 변형을 함께 받는다.
  "흰트", "핀트", "힌투", "힌드", "힌튜", "hint",
  "모루", "모룰", "몰르", "몰라겠", "머르겠", "머겠"
];
const HINT_NEGATION_KWS = [
  "힌트 필요 없어", "힌트 필요없어", "힌트 주지 마", "힌트 주지마", "힌트 안", "없이"
];

/** 일상 대화 / 서술어 종결어미 패턴 (Topic Shift 감지용) */
/**
 * 퀴즈 **자체에 대한 말**. 화제 전환이 아니다.
 *
 * 2026-08-20 대표님 실사용(세션 7cde49ed) — 아이가 정답을 맞힌 뒤 이렇게 말했다:
 *   아이: 이게 무슨 넌센스야?
 * 이 말이 화제 전환으로 분류돼 **세션이 조용히 끝났다**. 그 다음 턴에 아이가
 * "진행해" 라고 했지만 붙을 세션이 없어 케이가 즉흥으로 문제를 만들었고,
 * 가짜 게임플레이 가드가 그것을 잡아 "잠깐, 내가 순서를 헷갈렸어. 어떤 놀이부터
 * 할까?" 라는 메뉴 문구로 갈아치웠다. 대표님이 "퀴즈 내라고 했는데, 케이 멋데로
 * 종료 시키네" 라고 한 그 지점이다.
 *
 * 원칙은 대표님 지시 그대로다 — **아이가 그만하자고 할 때까지 퀴즈를 계속한다.**
 * 퀴즈가 시시하다·어렵다·뻔하다는 평은 그만하자는 뜻이 아니라 다음 문제를 달라는
 * 뜻에 가깝다. 그래서 세션을 끝내지 않고 다음 문제로 넘긴다.
 *
 * 명시적 중단("그만")·힌트·정답 공개 요청이 먼저 처리되므로 그 의도들을 가리지 않는다.
 */
const PLAY_META_PATTERNS: readonly RegExp[] = [
  /넌센스/,
  /퀴즈/,
  /문제/,
  /이런\s*거/,
  /(시시|뻔|쉽|어렵|재미없|웃기지도)/,
  /무슨\s*(말|소리|뜻)/,
];

const TOPIC_SHIFT_VERB_ENDINGS = [
  "했어", "했지", "했다", "할래", "먹었어", "갔어", "봤어", "인데", "거든", "잖아", "같아",
  "어때", "있어", "없어", "귀찮아", "힘들어", "뭐해", "언제 가", "어디 가", "싸웠어", "혼났어"
];

/**
 * 아이의 발화 의도를 결정론적으로 분류합니다 (§3-9, §3-15).
 */
export function classifyChildNonsenseUtterance(
  utterance: string,
  signals?: UtteranceSignals
): ChildNonsenseIntent {
  const trimmed = utterance.trim();

  // 1. 감정 / 갈등 / 안전 / 신체적 불편 신호 -> Topic Shift 최우선 (§3-15)
  if (
    signals?.hasNegativeEmotion ||
    signals?.hasConflict ||
    signals?.hasPhysicalNeed
  ) {
    return "TOPIC_SHIFT";
  }

  // 2. 명시적 중단 요청
  if (signals?.hasPlayStop || EXPLICIT_STOP_PATTERNS.some((p) => p.test(trimmed))) {
    return "STOP";
  }

  // 3. 다음 문제 요청
  if (NEXT_QUESTION_PATTERNS.some((p) => p.test(trimmed))) {
    return "NEXT_QUESTION";
  }

  // 4. 정답 바로 공개 요청
  if (REVEAL_ANSWER_PATTERNS.some((p) => p.test(trimmed))) {
    return "REVEAL_ANSWER";
  }

  // 5. 힌트 요청
  const hasHintKw = HINT_REQUEST_KWS.some((kw) => trimmed.includes(kw));
  const hasHintNeg = HINT_NEGATION_KWS.some((kw) => trimmed.includes(kw));
  if (hasHintKw && !hasHintNeg) {
    return "REQUEST_HINT";
  }

  // 5-A. 퀴즈 자체에 대한 말은 화제 전환이 아니다 — 세션을 끝내지 않고 계속한다.
  //       (그만·힌트·정답 요청은 위에서 이미 처리됐다)
  if (PLAY_META_PATTERNS.some((p) => p.test(trimmed))) {
    return "NEXT_QUESTION";
  }

  // 6. 일반 지식 질문 / 기억 회상 질의 -> Topic Shift
  if (signals?.hasGeneralKnowledgeQuestion || signals?.hasMemoryRecallQuery) {
    return "TOPIC_SHIFT";
  }

  // 6-A. 맨 긍정 응답은 퀴즈 답이 아니다 (2026-08-19 대표님 Dev QA).
  //
  // 실측(세션 c4f68596): 케이가 "다음 문제 또 풀어볼래?" 라고 물었고 아이가 "ㅇㅇ" 라고
  // 답했는데, 그게 **오답으로 채점됐다**(nonsense_question_history.outcome=ANSWERED_INCORRECT,
  // answered_at 17:36:47). 아이는 하겠다고 한 것인데 틀렸다는 소리를 들었다.
  //
  // "응"·"ㅇㅇ"·"그래"·"좋아" 같은 말은 어떤 넌센스 문제의 정답도 될 수 없다. 오답으로
  // 세지 말고 다음 문제로 넘긴다 — 케이가 방금 다음 문제를 권했을 가능성이 압도적이다.
  if (BARE_AFFIRMATIVE_PATTERN.test(trimmed)) {
    return "NEXT_QUESTION";
  }

  // 7. 긴 일상 서술문 (띄어쓰기 포함 7자 이상이면서 서술어 어미로 끝나는 경우)
  if (trimmed.includes(" ") && trimmed.length >= 7) {
    if (TOPIC_SHIFT_VERB_ENDINGS.some((ending) => trimmed.endsWith(ending) || trimmed.includes(ending))) {
      return "TOPIC_SHIFT";
    }
  }

  return "ANSWER_ATTEMPT";
}

export interface ValidationResult {
  isCorrect: boolean;
  normalizedChildAnswer: string;
  matchedAnswer?: string;
}

/**
 * 아이의 답변이 문제의 canonical_answer 또는 accepted_answers와 일치하는지 결정론적으로 판정합니다 (§3-9).
 * Gemini의 자의적 판단으로 정답/오답을 뒤집지 않습니다.
 */
export function validateNonsenseAnswer(
  childUtterance: string,
  question: NonsenseQuestionRow
): ValidationResult {
  const normalizedChild = normalizeNonsenseAnswer(childUtterance);
  if (!normalizedChild) {
    return {
      isCorrect: false,
      normalizedChildAnswer: "",
    };
  }

  const rawChild = childUtterance.trim().replace(/[\s!?.~^,;:…]+/g, "");
  const candidates = collectPlayAnswerCandidates(childUtterance, normalizeNonsenseAnswer);
  candidates.add(rawChild);

  const matches = (answer: string): boolean => {
    const answerNorm = normalizeNonsenseAnswer(answer);
    const answerRaw = answer.trim().replace(/[\s!?.~^,;:…]+/g, "");
    return (
      (answerNorm !== "" && candidates.has(answerNorm)) ||
      (answerRaw !== "" && candidates.has(answerRaw))
    );
  };

  // 1. canonical_answer 대조
  if (matches(question.canonical_answer)) {
    return {
      isCorrect: true,
      normalizedChildAnswer: normalizedChild,
      matchedAnswer: question.canonical_answer,
    };
  }

  // 2. accepted_answers 목록 대조
  const acceptedList = Array.isArray(question.accepted_answers)
    ? question.accepted_answers
    : [];

  for (const accepted of acceptedList) {
    if (matches(accepted)) {
      return {
        isCorrect: true,
        normalizedChildAnswer: normalizedChild,
        matchedAnswer: accepted,
      };
    }
  }

  return {
    isCorrect: false,
    normalizedChildAnswer: normalizedChild,
  };
}
