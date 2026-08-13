// K Conversation Engine — 발화 의미 신호 추출 (codex-rv 지적 반영: 기존
// lib/freechat/reactionEngine.ts의 10-카테고리 분류는 canned 템플릿 선택용으로 설계되어
// 071의 12개 Action을 구분하기엔 너무 성기다("100점 맞았어"가 neutral로 떨어지거나,
// 방귀/투명인간/기억회상/일반지식 질문이 전부 direct_question 하나로 뭉개짐).
// 이 파일은 Action Selector 전용의 더 세밀한 신호를 만든다 — canned 텍스트는 절대 생성하지 않는다.

export interface UtteranceSignals {
  hasAchievement: boolean; // 성공/합격/1등/맞았어/해냈어/이겼어
  hasConflict: boolean; // 친구와 싸움/삐짐/미움
  hasPlayfulSilly: boolean; // 방귀/똥/장난스러운 드립
  hasImaginative: boolean; // 상상/가정("~라면", "투명인간이라면")
  hasMemoryRecallQuery: boolean; // "전에 말했잖아/기억나?" 류 — 아이가 K에게 과거를 되묻는 것
  hasGeneralKnowledgeQuestion: boolean; // 사실/지식형 질문(케이 정체성/취향 질문 제외)
  hasNegativeEmotion: boolean;
  hasPositiveEmotion: boolean;
  hasPhysicalNeed: boolean;
  isVeryShortLowEffort: boolean; // 극단적으로 짧고 내용이 거의 없는 응답(2자 이하 등)
  hasChosungGameStart: boolean; // 초성 게임 시작 요청 ("초성게임 하자", "ㅊㅅ게임", "초성 퀴즈" 등)
  hasChosungAnswerAttempt: boolean; // 초성 게임 답변 시도로 보이는 발화 ("사과", "정답 사과", "바나나인가?")
  hasChosungHintRequest: boolean; // 초성 게임 힌트 요청 ("힌트 줘", "모르겠어", "어려워" 등)
}

const ACHIEVEMENT_KWS = ["1등", "100점", "맞았어", "해냈", "성공했", "이겼", "합격", "칭찬받"];
const CONFLICT_KWS = ["싸웠", "삐졌", "삐쳤", "미워", "화해", "절교", "다퉜"];
const PLAYFUL_SILLY_KWS = ["방귀", "똥", "히히", "ㅋㅋ", "ㅎㅎ", "웃겨", "장난"];
const IMAGINATIVE_KWS = ["라면 좋겠", "라면 어떨까", "만약", "상상", "투명인간", "된다면"];
const MEMORY_RECALL_KWS = ["기억나", "전에 말했", "저번에 말했", "아까 말했", "기억해"];
const NEGATIVE_EMOTION_KWS = ["화나", "화났", "짜증", "속상", "슬퍼", "슬펐", "우울", "무서워", "무섭", "불안", "억울", "서운", "답답"];
const POSITIVE_EMOTION_KWS = ["재밌", "재미", "최고", "좋았", "신나", "기뻐", "행복"];
const PHYSICAL_KWS = ["배고파", "배고프", "졸려", "졸리", "피곤", "지쳐", "아파", "아프"];
const QUESTION_WORDS = ["누구", "어디", "왜", "언제", "무엇", "어떻게", "얼마"];
// 케이 자기 정체성/취향에 대한 질문은 일반지식 질문이 아니라 kPeerPersona/코어 정체성이 이미 처리.
const IDENTITY_QUESTION_KWS = ["몇 살", "몇 학년", "너 이름", "너는 누구", "너 뭐 좋아"];

// 초성 게임 시작/참여 신호 키워드 및 패턴
const CHOSUNG_START_PATTERNS = [
  /(?:초성|ㅊㅅ)\s*(?:게임|놀이|퀴즈|맞추기|맞히기|배틀|대결)/,
  /(?:초성|ㅊㅅ)\s*문제\s*(?:내|내줘|내봐|줘)/,
  /(?:초성|ㅊㅅ)\s*(?:맞춰|맞혀)\s*(?:볼래|보자|봐)/,
  /(?:초성|ㅊㅅ)으로\s*(?:놀|하|해|게임|퀴즈)/,
];
const CHOSUNG_START_NEGATION_KWS = ["안 해", "안해", "안 할", "안할", "싫어", "하지 마", "하지마", "그만", "재미없"];
const CHOSUNG_START_DEFINITION_KWS = ["뭐야", "뭔데", "무슨 뜻", "무슨 말", "어떤 뜻", "의미", "알아?", "알려줘"];

// 초성 게임 힌트 요청 신호
const CHOSUNG_HINT_KWS = ["힌트", "모르겠", "어려워", "어렵다", "못 맞추겠", "못 맞히겠", "도저히 모르", "하나도 모르", "포기", "패스"];
const CHOSUNG_HINT_NEGATION_KWS = ["필요 없어", "필요없어", "주지 마", "주지마", "안 어려", "안어려", "없이"];

// 답변 시도 제외용 서술어/종결어미 패턴
const VERB_ENDING_PATTERN = /(?:했어|했지|했다|할래|하자|할게|하고|하면|해줘|줘|봐|보자|있어|없어|같아|네|네요|구요|잖아|거든|는데|데요|더라)$/;

const COMMON_NON_ANSWER_WORDS = new Set([
  "안녕", "하이", "헬로", "응", "어", "네", "예", "아니", "아냐", "싫어", "그래",
  "왜", "뭐", "누구", "어디", "언제", "어떻게", "얼마", "진짜", "정말", "헐",
  "대박", "와", "와우", "오", "우와", "방귀", "똥", "장난", "히히", "헤헤", "호호",
  "ㅋㅋ", "ㅎㅎ", "좋아", "싫다", "몰라", "알아",
]);

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function detectChosungGameStart(text: string): boolean {
  if (includesAny(text, CHOSUNG_START_NEGATION_KWS)) return false;
  if (includesAny(text, CHOSUNG_START_DEFINITION_KWS)) return false;
  return CHOSUNG_START_PATTERNS.some((pattern) => pattern.test(text));
}

function detectChosungHintRequest(text: string): boolean {
  if (includesAny(text, CHOSUNG_HINT_NEGATION_KWS)) return false;
  return includesAny(text, CHOSUNG_HINT_KWS);
}

function detectChosungAnswerAttempt(
  text: string,
  isStart: boolean,
  isHint: boolean,
  hasEmotionOrNeed: boolean,
): boolean {
  if (isStart || isHint) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. 명시적 정답 선언 ("정답 사과", "답은 바나나", "정답: 호랑이")
  if (/^(?:정답|답은|답이|답)\s*[:=!]?\s*[가-힣0-9a-zA-Z]{1,10}/.test(trimmed)) {
    return true;
  }

  // 2. 감정/신체상태 등 강한 상태 발화는 일반 대화로 우선 취급
  if (hasEmotionOrNeed) {
    return false;
  }

  // 3. 추측/확인형 ("사과인가", "바나나 맞아?", "혹시 호랑이?", "사과 아냐?", "사과 아니야?")
  // 3단계 전제: hasChosungAnswerAttempt는 게임 진행 중 컨텍스트에서만 호출되므로 재현율(recall)을 넓게 잡고 정밀도는 게임 세션 상태가 보장함.
  if (
    /^(?:혹시\s+[가-힣]{1,8}\s*(?:인가|인가요|맞아|맞지|맞나|아냐|아니야|아닌가)?|[가-힣]{1,8}\s*(?:인가|인가요|맞아|맞지|맞나|아냐|아니야|아닌가))[!?.~^]*$/.test(
      trimmed,
    )
  ) {
    return true;
  }

  // 4. 띄어쓰기 없는 1~6자 순수 한글 명사/단어 단독 발화 (문장부호 제외)
  const cleanWord = trimmed.replace(/^[!?.~^]+|[!?.~^]+$/g, "").trim();
  if (!cleanWord || cleanWord.includes(" ")) return false;

  // 서술어/동사형 어미로 끝나면 제외 ("게임하자", "심심해", "놀았어")
  if (VERB_ENDING_PATTERN.test(cleanWord)) return false;

  if (/^[가-힣]{1,6}$/.test(cleanWord)) {
    if (!COMMON_NON_ANSWER_WORDS.has(cleanWord)) {
      return true;
    }
  }

  return false;
}

export function extractUtteranceSignals(text: string): UtteranceSignals {
  const trimmed = text.trim();
  const isQuestion = /[?？]/.test(trimmed) || includesAny(trimmed, QUESTION_WORDS);
  const isIdentityQuestion = includesAny(trimmed, IDENTITY_QUESTION_KWS);

  const hasAchievement = includesAny(trimmed, ACHIEVEMENT_KWS);
  const hasConflict = includesAny(trimmed, CONFLICT_KWS);
  const hasNegativeEmotion = includesAny(trimmed, NEGATIVE_EMOTION_KWS);
  const hasPhysicalNeed = includesAny(trimmed, PHYSICAL_KWS);

  const hasChosungGameStart = detectChosungGameStart(trimmed);
  const hasChosungHintRequest = detectChosungHintRequest(trimmed);
  const hasChosungAnswerAttempt = detectChosungAnswerAttempt(
    trimmed,
    hasChosungGameStart,
    hasChosungHintRequest,
    hasAchievement || hasConflict || hasNegativeEmotion || hasPhysicalNeed,
  );

  return {
    hasAchievement,
    hasConflict,
    hasPlayfulSilly: includesAny(trimmed, PLAYFUL_SILLY_KWS),
    hasImaginative: includesAny(trimmed, IMAGINATIVE_KWS),
    hasMemoryRecallQuery: includesAny(trimmed, MEMORY_RECALL_KWS),
    hasGeneralKnowledgeQuestion: isQuestion && !isIdentityQuestion && !includesAny(trimmed, MEMORY_RECALL_KWS),
    hasNegativeEmotion,
    hasPositiveEmotion: includesAny(trimmed, POSITIVE_EMOTION_KWS),
    hasPhysicalNeed,
    isVeryShortLowEffort: trimmed.length <= 2 && !/[!?ㅋㅎ]/.test(trimmed),
    hasChosungGameStart,
    hasChosungAnswerAttempt,
    hasChosungHintRequest,
  };
}

/** semantic_group 추정 — Semantic Topic History 기록/조회에 쓸 대략적인 주제 그룹.
 * 071 §9의 MOOD_CHECK류 예시처럼 "의미가 같으면 같은 그룹"을 지향하되, 071 단계에서는
 * 질문은행 metadata(073에서 정식 도입)가 없으므로 신호 기반 근사치를 쓴다. */
export function estimateSemanticGroup(signals: UtteranceSignals): string {
  if (signals.hasChosungGameStart) return "PLAYFUL_GAME_CHOSUNG";
  if (signals.hasAchievement) return "ACHIEVEMENT";
  if (signals.hasConflict) return "FRIEND_CONFLICT";
  if (signals.hasNegativeEmotion) return "MOOD_CHECK";
  if (signals.hasPositiveEmotion) return "MOOD_CHECK";
  if (signals.hasPhysicalNeed) return "PHYSICAL_STATE";
  if (signals.hasMemoryRecallQuery) return "MEMORY_RECALL";
  if (signals.hasImaginative || signals.hasPlayfulSilly) return "PLAYFUL_IMAGINATION";
  if (signals.hasGeneralKnowledgeQuestion) return "GENERAL_QUESTION";
  return "GENERAL_CHAT";
}
