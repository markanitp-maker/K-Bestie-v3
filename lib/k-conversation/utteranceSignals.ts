import { recoverGameCommand } from "@/lib/stt/gameCommandRecovery";
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
  hasWordChainGameStart?: boolean; // 끝말잇기 게임 시작 요청 ("끝말잇기 하자", "말잇기" 등)
  hasPlayRequestWithoutTarget: boolean; // 심심해/놀아줘/뭐 하고 놀까 등 게임 미지정 놀이 요청
  hasGenericPlayAcceptance?: boolean; // 좋아/응/하자/게임부터 하자 등 놀이 포괄 수락
  hasPlayRejection: boolean; // 싫어/안 할래/하기 싫어/됐어 등 제안 거절 (단독 부정)
  hasPlayStop?: boolean; // 그만할래/안 할래/그만하자/그만 등 게임 명시적 종료 요청
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

/** 080: 게임 이름이 문장에 등장하기만 해도 시작 요청으로 잡히던 문제를 막는다.
 *  Production 사고 이후 "직접 요청이 활성 게임을 이긴다"로 바꾸면서, 비교·회상
 *  발화("이거 초성게임보다 재밌다", "끝말잇기 어제 했어")까지 게임을 강제 전환시켰다.
 *
 *  2026-08-17 재수정: 처음에는 "하자/할래" 같은 시작 의도 표현을 **요구**했으나,
 *  박말똥 Production 대화에서 "초성 퀴즈 하잖아", "너 끝말잇기 해 봐"가 목록에 없어
 *  게임이 아예 시작되지 않았다(초성 세션 0건). 아이가 쓰는 말끝은 무한히 많아
 *  화이트리스트로 감당할 수 없다.
 *
 *  그래서 **비교·회상 표현만 차단**하는 방식으로 바꾼다. 080에서 실제로 문제가 된
 *  것은 그 표현들뿐이었다. 못 잡아서 게임이 안 되는 쪽이, 가끔 잘못 잡히는 쪽보다
 *  훨씬 나쁘다. */
const PLAY_START_REFERENCE_KWS = [
  "보다 재밌", "보다 재미", "보다 나", "보다 좋",
  "말고", "대신",
  "했어", "했었", "했지", "했다", "하던", "했는데",
  "재밌었", "재미있었", "좋아했", "어땠", "기억나", "기억 나",
];

function isPlayReferenceOnly(text: string): boolean {
  return includesAny(text, PLAY_START_REFERENCE_KWS);
}

// 081-A: 능력·평가 화제 표지 (불평/질문을 게임 시작으로 오인 방지)
// 081 2차 리뷰: 처음엔 `하` 계열만 잡아 "초성게임 잘 못해"가 가드를 그냥 지나갔다.
// 한국어에서 "못 하"와 "못 해"는 글자가 달라 하나만 적으면 반드시 구멍이 난다.
const CAPABILITY_EVALUATION_PATTERNS = [
  /(?:못|안)\s*(?:하|해)/, // 안하지, 안 하네, 못하잖아, 잘 못해
  // "초성 문제 안 줘?"처럼 동사가 하/해가 아닌 부정형. 자모 복구 경로가
  // "문제"를 놀이 문맥으로 보고 게임을 열어버려서 여기서도 막아야 한다.
  /(?:못|안)\s*(?:줘|주|내|맞)/,
  /할\s*줄/, // 할 줄 알아, 할 줄 몰라
  /밖에/,
  /모르|몰라/,
];

// 081-A: 명시적 시작 의도 키워드
const EXPLICIT_START_INTENT_KWS = [
  "하자", "할래", "할까", "해줘", "해 줘", "내줘", "내 줘", "내봐", "내 봐",
  "해보자", "해 보자", "해봐", "해 봐", "놀자", "놀래", "시작", "가자",
  "하잖아", "하고 싶", "할게",
  // 081 리뷰 지적: "해볼래/해볼까/맞춰볼래" 계열이 빠져 있어, "초성게임 잘 모르지만
  // 해볼래" 같은 정상 요청이 능력 표지("모르")에 걸려 통째로 막혔다.
  "해볼래", "해 볼래", "해볼까", "해 볼까", "해보고", "해 보고",
  "맞춰볼래", "맞혀볼래", "맞춰보자", "맞혀보자",
  "문제 줘", "문제줘", "문제 내", "문제내",
];

/** 081 리뷰 지적: 아이가 케이의 말을 옮기며 불평하는 인용문 — "너 왜 맨날 초성게임
 *  하자고 해?" — 은 요청이 아니다. 능력 표지가 없어 위 가드에 걸리지 않으므로
 *  별도로 막는다. 인용형만 있고 실제 시작 표현이 없을 때만 차단한다. */
const PLAY_START_QUOTATIVE_PATTERNS = [/하자고/, /하재/, /한대/, /하냬/, /하라고/];

/** 081 리뷰 지적(치명): 시작 키워드를 부분일치로 찾으면 부정형·인용형이 그대로 걸린다.
 *  - "못하잖아" / "안하잖아" 는 "하잖아" 를 포함해 가드를 무력화했다 —
 *    "너 초성게임 잘 못하잖아" 가 게임을 시작시켰다.
 *  - "하자고 해?" 는 아이가 케이의 말을 인용하며 불평하는 것이지 요청이 아니다.
 *  시작 의도로 인정하기 전에 이 형태들을 먼저 제거한다. */
const NEGATED_OR_QUOTED_START_PATTERNS = [
  // "하라고 하잖아", "하자고 해" — 인용 뒤에 붙은 서술어까지 통째로 걷어낸다.
  // 인용형만 지우면 뒤의 "하잖아"가 시작 의도로 남아 가드가 뚫린다.
  // 반드시 아래 단독 인용형 패턴보다 먼저 와야 더 긴 쪽이 소비된다.
  /(?:하자고|하라고|하재|한대|하냬)\s*(?:하|해)[가-힣]*/,
  /(?:못|안)\s*(?:하|해)/,
  // 081 2차 리뷰: "초성 문제 안 줘?"처럼 부정형 뒤에 시작 키워드가 붙는 형태.
  // 위 `하|해` 패턴으로는 안 잡혀 "문제 줘"가 그대로 남았다.
  /(?:못|안)\s*(?:줘|주|내|맞)/,
  // 인용형은 아래 PLAY_START_QUOTATIVE_PATTERNS와 반드시 같은 목록이어야 한다.
  ...PLAY_START_QUOTATIVE_PATTERNS,
];

function hasExplicitStartIntent(text: string): boolean {
  if (!includesAny(text, EXPLICIT_START_INTENT_KWS)) return false;
  // 부정·인용 형태를 걷어낸 뒤에도 시작 키워드가 남아야 진짜 요청이다.
  const stripped = NEGATED_OR_QUOTED_START_PATTERNS.reduce(
    (acc, pattern) => acc.replace(new RegExp(pattern.source, "g"), " "),
    text,
  );
  return includesAny(stripped, EXPLICIT_START_INTENT_KWS);
}

function isBlockedByCapabilityOrEvaluation(text: string): boolean {
  const hasTopicMarker = CAPABILITY_EVALUATION_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasTopicMarker) return false;
  return !hasExplicitStartIntent(text);
}

function isQuotedPlayRequest(text: string): boolean {
  if (!PLAY_START_QUOTATIVE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return !hasExplicitStartIntent(text);
}

function detectChosungGameStart(text: string): boolean {
  if (includesAny(text, CHOSUNG_START_NEGATION_KWS)) return false;
  if (includesAny(text, CHOSUNG_START_DEFINITION_KWS) && !hasExplicitStartIntent(text)) return false;
  if (isPlayReferenceOnly(text)) return false;
  if (isBlockedByCapabilityOrEvaluation(text)) return false;
  if (isQuotedPlayRequest(text)) return false;
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

// 끝말잇기 게임 시작 신호
const WORD_CHAIN_START_PATTERNS = [
  /(?:끝말\s*잇기|끝말잇기|말잇기|단어\s*잇기|단어잇기)/,
  /(?:끝말|단어)\s*이어\s*(?:가기|하기|달리기)/,
];
const WORD_CHAIN_START_NEGATION_KWS = ["안 해", "안해", "안 할", "안할", "싫어", "하기 싫", "하지 마", "하지마", "그만", "재미없", "안 놀"];
const WORD_CHAIN_START_DEFINITION_KWS = ["뭐야", "뭔데", "무슨 뜻", "무슨 말", "어떤 뜻", "의미", "알아?", "알려줘", "규칙이 뭐야", "어떻게 하는"];

function detectWordChainGameStart(text: string): boolean {
  if (includesAny(text, WORD_CHAIN_START_NEGATION_KWS)) return false;
  if (includesAny(text, WORD_CHAIN_START_DEFINITION_KWS) && !hasExplicitStartIntent(text)) return false;
  if (isPlayReferenceOnly(text)) return false;
  if (isBlockedByCapabilityOrEvaluation(text)) return false;
  if (isQuotedPlayRequest(text)) return false;
  return WORD_CHAIN_START_PATTERNS.some((pattern) => pattern.test(text));
}

// 게임 미지정 놀이 요청 신호 ("심심해", "놀아줘", "뭐 하고 놀까", "재미없어" 등)
const PLAY_REQUEST_WITHOUT_TARGET_PATTERNS = [
  /심심(?:해|하다|해요|하네|한데|해용|당)?/,
  /지루(?:해|하다|해요|하네|한데)?/,
  /재미\s*(?:없어|없다|없네|없는데|없당)/,
  /놀아\s*(?:줘|줄래|주라|줘요|주세요)/,
  /놀고\s*(?:싶어|싶다|싶은데|싶어요)/,
  /뭐\s*(?:하고|할까|하지|하면서)\s*(?:놀까|놀아|놀지|놀래|할래|할까|하지)/,
  /(?:같이\s*|나랑\s*)?놀자/,
  /(?:게임|놀이|퀴즈)\s*(?:하자|할래|할까|할래\?|해줘|해봐|하고\s*싶어)/,
];
const PLAY_REQUEST_NEGATION_KWS = [
  "안 놀", "안놀", "놀기 싫", "안 해", "안해", "안 할", "안할", "하기 싫", "하지 마", "하지마", "그만", "안 심심",
];
const SPECIFIC_GAME_NAME_PATTERN = /(?:초성|ㅊㅅ|끝말|단어\s*잇기|단어잇기|스무고개|밸런스|수수께끼|보드게임|마피아)/;

function detectPlayRequestWithoutTarget(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart) return false;
  if (SPECIFIC_GAME_NAME_PATTERN.test(text)) return false;
  if (includesAny(text, PLAY_REQUEST_NEGATION_KWS)) return false;
  return PLAY_REQUEST_WITHOUT_TARGET_PATTERNS.some((pattern) => pattern.test(text));
}

// 놀이 제안 거절 신호 ("싫어", "안 할래", "하기 싫어", "됐어" 등 단독 부정)
const STANDALONE_REJECTION_PATTERN =
  /^(?:아니|아냐|음|그냥|그건|난|나는|지금은)?\s*(?:싫어|싫은데|싫다|안\s*할래|안해|안\s*해|하기\s*싫어|하기\s*싫은데|하기\s*싫다|됐어|됐거든|별로|별론데|그건\s*별로|그건\s*싫어|안\s*놀래|안\s*놀아|그만|그만할래|그만\s*해)[!?.~ㅋㅎ\s]*$/;

const REJECTION_EXCLUSION_PATTERNS = [
  /(?:말고|대신|싫고|말구)\s*.*(?:할래|하자|할까|하고\s*싶어|해줘)/,
  /(?:초성|끝말|단어|게임|놀이|스무고개).*할래/,
];

function detectPlayRejection(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
  hasPlayRequestWithoutTarget: boolean,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart || hasPlayRequestWithoutTarget) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const exclusion of REJECTION_EXCLUSION_PATTERNS) {
    if (exclusion.test(trimmed)) return false;
  }
  return STANDALONE_REJECTION_PATTERN.test(trimmed);
}

// 게임 명시적 종료 신호 ("그만할래", "안 할래", "그만하자", "그만", "안해" 등)
const PLAY_STOP_PATTERNS = [
  /(?:끝말잇기|초성|게임|놀이|퀴즈)?\s*(?:그만|그만하자|그만할래|그만해|그만둘래|안\s*할래|안해|안\s*해|하기\s*싫어|끝낼래|안\s*놀래|포기|항복|너\s*이겼어)/,
  /^(?:그만|그만해|그만하자|그만할래|끝|안해|안\s*해|싫어|포기|항복|이제\s*그만|다음에\s*할래)$/,
];

function detectPlayStop(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const exclusion of REJECTION_EXCLUSION_PATTERNS) {
    if (exclusion.test(trimmed)) return false;
  }
  return PLAY_STOP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// 놀이 제안 포괄 수락 신호 ("좋아", "응", "하자", "게임부터 하자", "게임하자", "해볼래", "그래", "오케이", "콜" 등)
const GENERIC_PLAY_ACCEPTANCE_PATTERNS = [
  /^(?:응|어|웅|네|예|오냐|그래|좋아|조아|좋아요|하자|할래|해|해볼래|해보자|해보자고|해볼까|시작하자|시작해|시작|콜|오케이|ok|ㅇㅇ|ㅇㅋ|좋지|좋징|당연하지|게임\s*하자|게임하자|게임부터\s*하자|게임부터\s*해|게임부터\s*먼저\s*해\s*보자|놀자|놀래)[!?.~^ㅋㅎ\s]*$/i,
  /(?:게임|놀이)\s*(?:부터|먼저)\s*(?:해\s*보자|하자|할래|해)/,
];

function detectGenericPlayAcceptance(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
  hasPlayRejection: boolean,
  hasPlayStop: boolean,
  hasNegativeEmotionOrConflict: boolean,
): boolean {
  if (
    hasChosungGameStart ||
    hasWordChainGameStart ||
    hasPlayRejection ||
    hasPlayStop ||
    hasNegativeEmotionOrConflict
  ) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) return false;
  return GENERIC_PLAY_ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function extractUtteranceSignals(text: string): UtteranceSignals {
  const trimmed = text.trim();
  const isQuestion = /[?？]/.test(trimmed) || includesAny(trimmed, QUESTION_WORDS);
  const isIdentityQuestion = includesAny(trimmed, IDENTITY_QUESTION_KWS);

  const hasAchievement = includesAny(trimmed, ACHIEVEMENT_KWS);
  const hasConflict = includesAny(trimmed, CONFLICT_KWS);
  const hasNegativeEmotion = includesAny(trimmed, NEGATIVE_EMOTION_KWS);
  const hasPhysicalNeed = includesAny(trimmed, PHYSICAL_KWS);

  // 정확 매칭이 먼저다. 실패했을 때만 STT 오인식 복구를 시도한다(2026-08-17).
  // 브라우저 STT가 "초성"을 "호성"으로, "퀴즈"를 "키즈"로 뭉개는 사례가 실제로 있었고
  // 그 탓에 초성게임이 한 번도 시작되지 않았다(박말똥 Production).
  let hasChosungGameStart = detectChosungGameStart(trimmed);
  const hasChosungHintRequest = detectChosungHintRequest(trimmed);
  const hasChosungAnswerAttempt = detectChosungAnswerAttempt(
    trimmed,
    hasChosungGameStart,
    hasChosungHintRequest,
    hasAchievement || hasConflict || hasNegativeEmotion || hasPhysicalNeed,
  );
  let hasWordChainGameStart = detectWordChainGameStart(trimmed);
  // 복구 계층도 비교·회상 차단을 똑같이 거쳐야 한다. 안 그러면 정확 매칭에서 막은
  // "이거 초성게임보다 재밌다"가 복구로 되살아난다(2026-08-17 실측).
  // 복구 계층도 정확 매칭과 같은 가드를 전부 거쳐야 한다. 안 그러면 정확 매칭에서
  // 막은 발화가 복구로 되살아난다 — "이거 초성게임보다 재밌다"(비교),
  // "초성게임 안 할래"(거절), "초성이 뭐야?"(정의 질문) 모두 실측으로 확인됐다.
  const blockedFromRecovery =
    isPlayReferenceOnly(trimmed)
    || isBlockedByCapabilityOrEvaluation(trimmed)
    || isQuotedPlayRequest(trimmed)
    || includesAny(trimmed, CHOSUNG_START_NEGATION_KWS)
    || (includesAny(trimmed, CHOSUNG_START_DEFINITION_KWS) && !hasExplicitStartIntent(trimmed))
    || includesAny(trimmed, WORD_CHAIN_START_NEGATION_KWS)
    || (includesAny(trimmed, WORD_CHAIN_START_DEFINITION_KWS) && !hasExplicitStartIntent(trimmed));

  if (!hasChosungGameStart && !hasWordChainGameStart && !blockedFromRecovery) {
    const recovered = recoverGameCommand(trimmed);
    if (recovered === "CHOSUNG") hasChosungGameStart = true;
    else if (recovered === "WORD_CHAIN") hasWordChainGameStart = true;
  }
  const hasPlayRequestWithoutTarget = detectPlayRequestWithoutTarget(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
  );
  const hasPlayRejection = detectPlayRejection(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    hasPlayRequestWithoutTarget,
  );
  const hasPlayStop = detectPlayStop(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
  );
  const hasGenericPlayAcceptance = detectGenericPlayAcceptance(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    hasPlayRejection,
    Boolean(hasPlayStop),
    hasNegativeEmotion || hasConflict || hasPhysicalNeed,
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
    hasWordChainGameStart,
    hasPlayRequestWithoutTarget,
    hasGenericPlayAcceptance,
    hasPlayRejection,
    hasPlayStop,
  };
}

/** semantic_group 추정 — Semantic Topic History 기록/조회에 쓸 대략적인 주제 그룹.
 * 071 §9의 MOOD_CHECK류 예시처럼 "의미가 같으면 같은 그룹"을 지향하되, 071 단계에서는
 * 질문은행 metadata(073에서 정식 도입)가 없으므로 신호 기반 근사치를 쓴다. */
export function estimateSemanticGroup(signals: UtteranceSignals): string {
  if (signals.hasChosungGameStart) return "PLAYFUL_GAME_CHOSUNG";
  if (signals.hasWordChainGameStart) return "PLAYFUL_GAME_WORD_CHAIN";
  if (signals.hasPlayRequestWithoutTarget) return "PLAY_PROPOSAL";
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
