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
  hasChosungAnswerRequest: boolean; // 초성 게임 정답 직접 공개 요청 ("답이 뭐야", "정답 알려줘", "그냥 알려줘" 등)
  hasChosungNextQuestion: boolean; // 다음 문제 요청 ("다음 문제 줘", "다른 문제", "패스")
  hasWordChainGameStart?: boolean; // 끝말잇기 게임 시작 요청 ("끝말잇기 하자", "말잇기" 등)
  hasNonsenseGameStart?: boolean; // 넌센스 퀴즈 / 수수께끼 시작 요청 ("넌센스 퀴즈 하자", "수수께끼 하자" 등)
  hasNonsenseAnswerAttempt?: boolean;
  hasNonsenseHintRequest?: boolean;
  hasPlayRequestWithoutTarget: boolean; // 심심해/놀아줘/뭐 하고 놀까 등 게임 미지정 놀이 요청
  hasGenericPlayAcceptance?: boolean; // 좋아/응/하자/게임부터 하자 등 놀이 포괄 수락
  hasPlayRejection: boolean; // 싫어/안 할래/하기 싫어/됐어 등 제안 거절 (단독 부정)
  hasPlayStop?: boolean; // 그만할래/안 할래/그만하자/그만 등 게임 명시적 종료 요청
  /** 018 §3-11 — 아이가 케이에게 친근감·애착을 표현했는지("케이 좋아해", "너는 내 친한 친구야").
   *  이 말을 그냥 지나치고 다음 질문으로 넘어가면 아이는 무시당했다고 느낀다.
   *  먼저 받아준 뒤 이어가야 한다. 대신 독점·의존을 유도하는 답은 관계 안전이 따로 막는다. */
  hasAffectionTowardK: boolean;
}

const ACHIEVEMENT_KWS = ["1등", "100점", "맞았어", "해냈", "성공했", "이겼", "합격", "칭찬받"];
const CONFLICT_KWS = ["싸웠", "삐졌", "삐쳤", "미워", "화해", "절교", "다퉜"];
const PLAYFUL_SILLY_KWS = ["방귀", "똥", "히히", "ㅋㅋ", "ㅎㅎ", "웃겨", "장난"];
const IMAGINATIVE_KWS = ["라면 좋겠", "라면 어떨까", "만약", "상상", "투명인간", "된다면"];
const MEMORY_RECALL_KWS = ["기억나", "전에 말했", "저번에 말했", "아까 말했", "기억해"];
const NEGATIVE_EMOTION_KWS = ["화나", "화났", "짜증", "속상", "슬퍼", "슬펐", "우울", "무서워", "무섭", "불안", "억울", "서운", "답답"];
const POSITIVE_EMOTION_KWS = ["재밌", "재미", "최고", "좋았", "신나", "기뻐", "행복"];

// 018 §3-11 — 케이를 향한 친근감·애착 표현.
//
// "좋아" 한 글자로 잡으면 "이거 좋아", "축구 좋아" 까지 걸린다. 그건 애착 표현이 아니라
// 평범한 취향 얘기다. **대상이 케이여야** 하므로 케이를 부르는 말과 함께 있을 때만 잡는다.
const AFFECTION_TOWARD_K_PATTERNS: readonly RegExp[] = [
  // "케이 좋아해", "너 좋아", "너가 제일 좋아", "케이가 좋아"
  /(?:케이|너|니|네)(?:가|는|을|를|랑|한테)?\s*(?:정말\s*|진짜\s*|제일\s*|너무\s*)?좋아/,
  // "너랑 얘기하는 게 재밌어", "케이랑 노는 거 재밌어"
  /(?:케이|너|니)(?:랑|와|하고|과)\s*[가-힣\s]{0,10}(?:재밌|재미있|좋)/,
  // "너는 내 친한 친구야", "케이는 내 베프야", "내 제일 친한 친구는 케이야"
  //
  // 대상이 케이임을 반드시 요구한다. `내 친구` 만 보면 "민준이는 내 친구랑 싸웠어" 처럼
  // 실제 친구 얘기가 애착 표현으로 잡힌다(테스트 실패로 잡았다, 2026-08-19).
  /(?:케이|너|니)(?:는|은|가)?\s*(?:내|나의)\s*(?:제일\s*|가장\s*)?(?:친한\s*)?(?:친구|베프|절친)/,
  /(?:내|나의)\s*(?:제일\s*|가장\s*)?(?:친한\s*)?(?:친구|베프|절친)(?:는|은|가)?\s*(?:케이|너)/,
  // "우리 친구지?", "우리 친구야" — 케이에게 하는 말이다
  /우리\s*(?:친구|베프|절친)(?:지|야|다|잖아)/,
  // "케이 보고 싶었어", "너 만나고 싶었어" — 대상이 케이일 때만.
  // "엄마 보고 싶어" 는 애착 표현이 아니라 들어줘야 하는 얘기다.
  /(?:케이|너|니)(?:가|를|랑|한테)?\s*(?:정말\s*|진짜\s*|너무\s*)?(?:보고\s*싶|만나고\s*싶)/,
  // "고마워 케이", "케이 고마워"
  /(?:케이)\s*(?:정말\s*|진짜\s*)?고마워|고마워\s*케이/,
];
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

// 초성 게임 정답 직접 공개 요청 신호 ("답이 뭐야", "정답 알려줘", "그냥 알려줘" 등)
const CHOSUNG_ANSWER_REQUEST_KWS = [
  "알려 줘", "알려줘", "알려 주라", "알려주라", "알려 줘봐", "알려줘봐",
  "가르쳐 줘", "가르쳐줘", "가르쳐 주라", "가르쳐주라", "가르쳐 줘봐", "가르쳐줘봐",
  "정답 뭐", "정답이 뭐", "정답 뭐야", "정답이 뭐야", "정답 알려", "정답 말해",
  "답이 뭐", "답 뭐야", "답이 뭐야", "답 알려", "답 말해", "답 뭔데", "정답 뭔데",
  "그냥 알려", "그냥 가르쳐",
];

// 초성 게임 힌트 요청 신호
const CHOSUNG_HINT_KWS = [
  "힌트", "모르겠", "어려워", "어렵다", "못 맞추겠", "못 맞히겠", "도저히 모르", "하나도 모르", "포기", "패스",
  "뭔데",
  // 010 대표님 QA 실측(2026-08-20 00:08): 아이가 "몰라" 라고 했는데 어떤 신호에도 안 걸려
  // 초성게임 스킬이 그 턴을 처리하지 못했다. 그러면 LLM 이 게임을 흉내내고, 그걸 가드가
  // 막아 놀이 목록으로 리셋된다("무슨 놀이 할지 네가 골라줄래?"). 게임이 통째로 날아간다.
  // "모르겠" 은 있는데 "몰라" 가 없었다 — 아이가 실제로 더 많이 쓰는 쪽이 빠져 있었다.
  "몰라", "몰르", "모르겠어", "잘 모르",
];
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

/**
 * 다음 문제를 달라는 요청(015 2차).
 *
 * 2026-08-19 Dev QA 실측: 아이가 "다음 문제 줘" 라고 했는데 어떤 신호에도 안 걸려
 * 케이가 이미 낸 초성을 다시 제시하고 "다음 문제 계속 해보자"라고만 했다.
 * 아이 입장에서는 요청이 무시된 것이다.
 */
const CHOSUNG_NEXT_QUESTION_KWS = [
  "다음 문제", "다음문제", "다른 문제", "다른문제", "다음 거", "다음거",
  "새 문제", "새문제", "문제 바꿔", "다음 것", "패스", "넘어가",
];

/**
 * "다음 문제는 OO" 처럼 다음 문제를 **화제로 삼아 답을 말하는** 형태.
 *
 * 2026-08-19 대표님 QA 실측: 아이가 "다음 문제는 반은우" 라고 답했는데 이걸 다음 문제
 * 요청으로 보고 정답을 공개하고 넘어갔다. 아이는 "너무 빨리 정답을 알려 주는 거 아냐"
 * 라고 했다. 조사 "는/은" 이 붙으면 요청이 아니라 그 문제에 대해 말하는 것이다.
 */
const NEXT_QUESTION_AS_TOPIC = /(?:다음|다른|새)\s*(?:문제|거|것)\s*(?:는|은)\s*\S/;

function detectChosungNextQuestion(text: string): boolean {
  if (NEXT_QUESTION_AS_TOPIC.test(text)) return false;
  return includesAny(text, CHOSUNG_NEXT_QUESTION_KWS);
}

function detectChosungAnswerRequest(text: string): boolean {
  if (includesAny(text, CHOSUNG_HINT_NEGATION_KWS)) return false;
  // "힌트 좀 알려줘" 는 답을 달라는 말이 아니다. "알려줘" 만 보고 정답을 공개하면
  // 아이는 힌트를 원했는데 답이 튀어나와 게임이 그 자리에서 끝난다.
  // 힌트를 말했으면 언제나 힌트 요청이다.
  if (text.includes("힌트")) return false;
  return includesAny(text, CHOSUNG_ANSWER_REQUEST_KWS);
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
  isAnswerRequest: boolean = false,
): boolean {
  if (isStart || isHint || isAnswerRequest) return false;
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
  if (!cleanWord) return false;

  // 한 낱말 발화일 때만 이 규칙을 적용한다. 여러 낱말이면 아래 규칙 5 로 넘긴다.
  if (!cleanWord.includes(" ")) {
    // 서술어/동사형 어미로 끝나면 제외 ("게임하자", "심심해", "놀았어")
    if (VERB_ENDING_PATTERN.test(cleanWord)) return false;

    if (/^[가-힣]{1,6}$/.test(cleanWord)) {
      if (!COMMON_NON_ANSWER_WORDS.has(cleanWord)) {
        return true;
      }
    }
    return false;
  }

  // 5. 답을 말로 감싸서 말한 경우.
  //
  // 규칙 4 는 발화 전체가 한 낱말일 때만 통과시킨다. 그런데 아이는 답만 딱 말하지 않는다.
  // 2026-08-19 김서아 Dev QA 실측: 정답이 "공놀이"인 문제에 아이가 "그러니까 공놀이 이라고"
  // 라고 답했는데 답변 시도로 인식되지 않아 정답 대조까지 가지도 못했다. 케이는 오답이라고
  // 했고 세션은 그대로 멈췄다.
  //
  // 인용 표지("~라고")나 군말("그러니까", "어") 이 있을 때만 이 규칙을 태운다. 그것마저
  // 없으면 평범한 대화일 가능성이 높으므로 건드리지 않는다.
  // 여기서 넓혀도 안전한 이유는 규칙 3 주석과 같다 — 이 판정은 게임 진행 중에만 쓰이고,
  // 실제 정답 여부는 세션의 정답과 대조해 결정된다.
  const FILLER_PREFIXES = /^(?:그러니까|그니까|그러면|그럼|어|음|아|저기|그|내\s*답은|답은)\s+/;
  const QUOTATIVE = /(?:이?라고(?:요)?|이?라니까)\s*$/;
  const hasFiller = FILLER_PREFIXES.test(trimmed);
  const hasQuotative = QUOTATIVE.test(trimmed);
  if (!hasFiller && !hasQuotative) return false;

  const stripped = trimmed
    .replace(FILLER_PREFIXES, "")
    .replace(QUOTATIVE, "")
    .trim();
  const tokens = [
    ...new Set(
      stripped
        .split(/\s+/)
        .map((token) => token.replace(/^[!?.~^,]+|[!?.~^,]+$/g, ""))
        .filter(Boolean)
    ),
  ];
  if (tokens.length === 0 || tokens.length > 2) return false;
  const looksLikeWord = (token: string) =>
    /^[가-힣]{1,6}$/.test(token) && !VERB_ENDING_PATTERN.test(token);
  if (!tokens.every(looksLikeWord)) return false;
  return tokens.some((token) => !COMMON_NON_ANSWER_WORDS.has(token));
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

// 넌센스 퀴즈 / 수수께끼 게임 시작 신호 (§3-1)
const NONSENSE_START_PATTERNS = [
  /(?:넌센스|수수께끼)\s*(?:게임|놀이|퀴즈|맞추기|맞히기|배틀|대결)/,
  // 단독 "내"를 넣으면 안 된다. "내면 안 돼", "내달라고 한 적 없어", "내줬어"가 전부 걸린다.
  // 명령형 어미만 받고, 뒤에 다른 한글이 붙으면(내줘서·내줬던) 요청이 아니므로 제외한다.
  /(?:넌센스|수수께끼)\s*(?:퀴즈\s*)?(?:문제\s*)?(?:내줘|내봐|내주라|줘)(?:요)?(?![가-힣])/,
  /(?:넌센스|수수께끼)\s*(?:맞춰|맞혀)\s*(?:볼래|보자|봐)/,
  /(?:넌센스|수수께끼)(?:으로|\s*)\s*(?:놀|하|해|게임|퀴즈)/,
  /(?:수수께끼|넌센스\s*퀴즈|넌센스퀴즈|넌센스)\s*(?:하자|할래|할까|해줘|해봐|하고\s*싶어)/,
];
// "내지 마"는 반드시 "하지 마"와 함께 둔다 — 출제 요청 패턴이 "내"를 잡기 때문에
// 이게 없으면 "수수께끼 내지 마"가 시작 신호가 된다(2026-08-17 실측).
const NONSENSE_START_NEGATION_KWS = ["안 해", "안해", "안 할", "안할", "싫어", "하기 싫", "하지 마", "하지마", "내지 마", "내지마", "주지 마", "주지마", "그만", "재미없", "안 놀"];
const NONSENSE_START_DEFINITION_KWS = ["뭐야", "뭔데", "무슨 뜻", "무슨 말", "어떤 뜻", "의미", "알아?", "알려줘", "규칙이 뭐야", "어떻게 하는"];

function detectNonsenseGameStart(text: string): boolean {
  if (includesAny(text, NONSENSE_START_NEGATION_KWS)) return false;
  if (includesAny(text, NONSENSE_START_DEFINITION_KWS) && !hasExplicitStartIntent(text)) return false;
  if (isPlayReferenceOnly(text)) return false;
  if (isBlockedByCapabilityOrEvaluation(text)) return false;
  if (isQuotedPlayRequest(text)) return false;
  return NONSENSE_START_PATTERNS.some((pattern) => pattern.test(text));
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
  // 010 대표님 QA 실측(2026-08-20 00:11~00:12): 아이가 "다른놀이", "다른 놀이 하라고" 를
  // 세 번이나 말했는데 어떤 신호에도 걸리지 않아 케이가 계속 끝말잇기를 밀어붙였다.
  // 지금 하는 놀이를 바꾸자는 요청은 "놀이를 하자" 와 같은 종류의 신호로 받아야 한다.
  // 붙여쓰기("다른놀이")와 종결어미 없는 형태("다른 게임")도 잡는다 — 아이는 그렇게 쓴다.
  // 리뷰 지적(2026-08-20 MAJOR): 종결어미를 옵셔널로 두고 "거" 까지 넣었더니
  // "딴 거 먹고 싶어", "다른 거 좋아" 같은 일상 대화가 전부 놀이 변경 요청으로 잡혀
  // 하던 게임을 강제 종료시켰다. 두 가지로 좁힌다 —
  //   · 놀이 낱말(게임/놀이/퀴즈)이면 종결어미 없이도 인정한다("다른놀이" 는 그렇게 온다)
  //   · "거" 처럼 대상이 모호한 말은 놀이 동사가 붙어야만 인정한다("다른 거 하자")
  /(?:다른|딴|새)\s*(?:게임|놀이|퀴즈)(?:\s*(?:하자|할래|할까|해줘|해봐|해|하라고|하자고|줘))?/,
  /(?:다른|딴|새)\s*거\s*(?:하자|할래|할까|해줘|해봐|하라고|하자고)/,
  /(?:게임|놀이)\s*(?:바꾸|바꿔|변경)/,
];
const PLAY_REQUEST_NEGATION_KWS = [
  "안 놀", "안놀", "놀기 싫", "안 해", "안해", "안 할", "안할", "하기 싫", "하지 마", "하지마", "그만", "안 심심",
];
const SPECIFIC_GAME_NAME_PATTERN = /(?:초성|ㅊㅅ|끝말|단어\s*잇기|단어잇기|스무고개|밸런스|수수께끼|넌센스|보드게임|마피아)/;

function detectPlayRequestWithoutTarget(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
  hasNonsenseGameStart: boolean = false,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart || hasNonsenseGameStart) return false;
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
  hasNonsenseGameStart: boolean = false,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart || hasNonsenseGameStart || hasPlayRequestWithoutTarget) {
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
  /(?:끝말잇기|초성|넌센스|수수께끼|게임|놀이|퀴즈)?\s*(?:그만|그만하자|그만할래|그만해|그만둘래|안\s*할래|안해|안\s*해|하기\s*싫어|끝낼래|안\s*놀래|포기|항복|너\s*이겼어)/,
  /^(?:그만|그만해|그만하자|그만할래|끝|안해|안\s*해|싫어|포기|항복|이제\s*그만|다음에\s*할래)$/,
];

function detectPlayStop(
  text: string,
  hasChosungGameStart: boolean,
  hasWordChainGameStart: boolean,
  hasNonsenseGameStart: boolean = false,
): boolean {
  if (hasChosungGameStart || hasWordChainGameStart || hasNonsenseGameStart) return false;
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
  hasNonsenseGameStart: boolean = false,
): boolean {
  if (
    hasChosungGameStart ||
    hasWordChainGameStart ||
    hasNonsenseGameStart ||
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
  let hasChosungGameStart = detectChosungGameStart(trimmed);
  const hasChosungAnswerRequest = detectChosungAnswerRequest(trimmed);
  const hasChosungNextQuestion = detectChosungNextQuestion(trimmed);
  const hasChosungHintRequest = !hasChosungAnswerRequest && detectChosungHintRequest(trimmed);
  const hasChosungAnswerAttempt = detectChosungAnswerAttempt(
    trimmed,
    hasChosungGameStart,
    hasChosungHintRequest,
    hasAchievement || hasConflict || hasNegativeEmotion || hasPhysicalNeed,
    hasChosungAnswerRequest,
  );
  let hasWordChainGameStart = detectWordChainGameStart(trimmed);
  let hasNonsenseGameStart = detectNonsenseGameStart(trimmed);

  const blockedFromRecovery =
    isPlayReferenceOnly(trimmed)
    || isBlockedByCapabilityOrEvaluation(trimmed)
    || isQuotedPlayRequest(trimmed)
    || includesAny(trimmed, CHOSUNG_START_NEGATION_KWS)
    || (includesAny(trimmed, CHOSUNG_START_DEFINITION_KWS) && !hasExplicitStartIntent(trimmed))
    || includesAny(trimmed, WORD_CHAIN_START_NEGATION_KWS)
    || (includesAny(trimmed, WORD_CHAIN_START_DEFINITION_KWS) && !hasExplicitStartIntent(trimmed))
    || includesAny(trimmed, NONSENSE_START_NEGATION_KWS)
    || (includesAny(trimmed, NONSENSE_START_DEFINITION_KWS) && !hasExplicitStartIntent(trimmed));

  if (!hasChosungGameStart && !hasWordChainGameStart && !hasNonsenseGameStart && !blockedFromRecovery) {
    const recovered = recoverGameCommand(trimmed);
    if (recovered === "CHOSUNG") hasChosungGameStart = true;
    else if (recovered === "WORD_CHAIN") hasWordChainGameStart = true;
    else if (recovered === "NONSENSE_QUIZ") hasNonsenseGameStart = true;
  }
  const hasPlayRequestWithoutTarget = detectPlayRequestWithoutTarget(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    Boolean(hasNonsenseGameStart),
  );
  const hasPlayRejection = detectPlayRejection(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    hasPlayRequestWithoutTarget,
    Boolean(hasNonsenseGameStart),
  );
  const hasPlayStop = detectPlayStop(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    Boolean(hasNonsenseGameStart),
  );
  const hasGenericPlayAcceptance = detectGenericPlayAcceptance(
    trimmed,
    hasChosungGameStart,
    Boolean(hasWordChainGameStart),
    hasPlayRejection,
    Boolean(hasPlayStop),
    hasNegativeEmotion || hasConflict || hasPhysicalNeed,
    Boolean(hasNonsenseGameStart),
  );

  return {
    hasChosungNextQuestion,
    hasAffectionTowardK: AFFECTION_TOWARD_K_PATTERNS.some((pattern) => pattern.test(trimmed)),
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
    hasChosungAnswerRequest,
    hasWordChainGameStart,
    hasNonsenseGameStart,
    hasPlayRequestWithoutTarget,
    hasGenericPlayAcceptance,
    hasPlayRejection,
    hasPlayStop,
  };
}

/** semantic_group 추정 — Semantic Topic History 기록/조회에 쓸 대략적인 주제 그룹. */
export function estimateSemanticGroup(signals: UtteranceSignals): string {
  if (signals.hasChosungGameStart) return "PLAYFUL_GAME_CHOSUNG";
  if (signals.hasWordChainGameStart) return "PLAYFUL_GAME_WORD_CHAIN";
  if (signals.hasNonsenseGameStart) return "PLAYFUL_GAME_NONSENSE_QUIZ";
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
