// requests/request-parent-k-chat-intent-routing-fallback-fix.md — 부모–케이 대화의
// 모든 입력을 조건 없이 아이 정보 검색으로 보내던 문제를 고친다. 고신뢰 규칙으로
// 명확한 케이스(인사/감사/연결확인/피드백)를 먼저 걸러내고, 그 외에는 기존처럼
// 아이 정보 질문(CHILD_INFORMATION_QUERY)으로 처리한다(§5.2 — 애매하면 안전한
// 기존 경로 유지, 함부로 새 Retrieval 미실행 분기로 오분류하지 않는다).
export type ParentKChatIntent =
  | "GENERAL_CONVERSATION"
  | "FEEDBACK_OR_CORRECTION"
  | "CHILD_INFORMATION_QUERY"
  | "PARENT_QUERY_REQUEST"
  | "PARENT_QUERY_REQUEST_CANCEL";

export interface IntentClassification {
  intent: ParentKChatIntent;
  confidence: number;
  // requests/request-parent-k-conversation-context-and-draft-edit-fix.md §5/§7 —
  // 직전 K 응답이 아직 확정·취소되지 않은 "아이에게 물어보기" 제안(pending draft)을
  // 남긴 상태에서 이 입력이 그 제안에 대한 후속 수정/보정으로 판정됐음을 표시한다.
  // true면 호출측(route.ts)이 이전 제안 텍스트와 이번 입력을 합쳐 재작성 파이프라인에
  // 넘긴다(신규 기록조회로 떨어뜨리지 않음).
  isFollowUpToPendingDraft?: boolean;
}

export interface ParentQueryContextTurn {
  role: "user" | "k";
  text: string;
  askChildProposal?: string | null;
  lastUnknownDetail?: string | null;
  targetDate?: string | null;
}

export interface AskChildProposalContext {
  proposal: string;
  requestedTopic: string;
}

const CONTEXTUAL_QUERY_REQUEST_PATTERN = /^(그럼|그러면|그렇다면|그걸|그거|직접)(?:\s|,)/;
const PLAIN_QUERY_REQUEST_PATTERN = /^(?:그럼\s*)?(?:아이(?:에게)?\s*)?(?:물어\s*봐(?:\s*줘|\s*줄래)?|여쭤\s*봐(?:\s*줘)?)[.!?\s]*$/;

const PROPOSAL_MAX_LENGTH = 300;
const REQUESTED_TOPIC_MAX_LENGTH = 120;

/**
 * 직전 부모 주제를 유지하면서도 부모 문장을 아이 질문으로 직접 전달하지 않는 재작성 입력을 만든다.
 * codex-rv 지적 반영: currentRequest(이번 요청)는 재작성 파이프라인이 실제로 반응해야 할
 * 신규 지시이므로 길이 제한 시 과거 맥락보다 항상 우선 보존한다 — 과거 맥락이 잘리는 것은
 * 허용하되 currentRequest가 통째로 사라지는 것은 허용하지 않는다(기존엔 pendingProposal이
 * 이미 300자면 수정 요청 전체가 잘려나갔다). CONTEXTUAL_QUERY_REQUEST_PATTERN은 접두어만
 * 보는 휴리스틱이라 오탐 가능하므로, 이전 주제는 "참고/확정 아님"으로 표시하고 현재 요청을
 * "우선"으로 명시해 하위 LLM(classifyAndRewriteParentQuestion)이 오탐 시에도 현재 요청의
 * 독립 주제를 우선 해석하도록 유도한다.
 */
export function buildAskChildProposal(
  currentRequest: string,
  conversationContext: ParentQueryContextTurn[],
  pendingProposal: string | null,
  isPendingEdit: boolean,
): AskChildProposalContext {
  if (isPendingEdit && pendingProposal) {
    // codex-rv r2 지적: 먼저 통짜 문자열을 만들고 나서 .slice()하면 pendingProposal이
    // 이미 최대 길이에 근접했을 때 currentRequest 뒷부분(닫는 괄호 포함)이 통째로
    // 잘려나갈 수 있다. 라벨의 고정 오버헤드(접두/접미 문구 길이)를 먼저 계산해
    // currentRequest 몫을 그 안에서만 자르고, 라벨은 항상 완전한 형태로 조립한다.
    const editPrefix = " (수정 요청: ";
    const editSuffixChar = ")";
    const editOverhead = editPrefix.length + editSuffixChar.length;
    const requestBudget = Math.max(0, PROPOSAL_MAX_LENGTH - editOverhead);
    const suffix = `${editPrefix}${currentRequest.slice(0, requestBudget)}${editSuffixChar}`;
    const pendingBudget = Math.max(0, PROPOSAL_MAX_LENGTH - suffix.length);
    return {
      proposal: `${pendingProposal.slice(0, pendingBudget)}${suffix}`,
      requestedTopic: pendingProposal.slice(0, REQUESTED_TOPIC_MAX_LENGTH),
    };
  }

  if (PLAIN_QUERY_REQUEST_PATTERN.test(currentRequest)) {
    const previousUnknown = [...conversationContext]
      .reverse()
      .find((turn) => turn.role === "k" && (turn.askChildProposal || turn.lastUnknownDetail));
    if (previousUnknown) {
      const detail = (previousUnknown.lastUnknownDetail || previousUnknown.askChildProposal || "").trim();
      return {
        proposal: (previousUnknown.askChildProposal || detail).slice(0, PROPOSAL_MAX_LENGTH),
        requestedTopic: detail.slice(0, REQUESTED_TOPIC_MAX_LENGTH),
      };
    }
  }

  const previousUserTurn = [...conversationContext]
    .reverse()
    .find((turn) => turn.role === "user" && turn.text.trim().length > 0);
  if (CONTEXTUAL_QUERY_REQUEST_PATTERN.test(currentRequest) && previousUserTurn) {
    const requestedTopic = previousUserTurn.text.trim().slice(0, REQUESTED_TOPIC_MAX_LENGTH);
    const currentPrefix = "\n현재 요청(우선): ";
    const prefixLabel = "참고(직전 주제, 확정 아님): ";
    // codex-rv r3 지적: requestBudget이 currentPrefix 길이만 빼고 prefixLabel 길이를
    // 빼지 않아, currentRequest가 길면(≥288자) 최종 조립 길이가 300자를 넘을 수 있었다
    // (18+0+300=318). 두 라벨의 고정 길이를 먼저 모두 뺀 뒤에만 currentRequest 몫을 정한다.
    const requestBudget = Math.max(0, PROPOSAL_MAX_LENGTH - currentPrefix.length - prefixLabel.length);
    const suffix = `${currentPrefix}${currentRequest.slice(0, requestBudget)}`;
    const contextBudget = Math.max(0, PROPOSAL_MAX_LENGTH - suffix.length - prefixLabel.length);
    return {
      proposal: `${prefixLabel}${requestedTopic.slice(0, contextBudget)}${suffix}`,
      requestedTopic,
    };
  }

  return {
    proposal: currentRequest.slice(0, PROPOSAL_MAX_LENGTH),
    requestedTopic: currentRequest.slice(0, REQUESTED_TOPIC_MAX_LENGTH),
  };
}

// requests/request-parent-k-query-router-error-analysis-dev-prod.md §5.1(가설 A 확정) —
// "아이에게 ~ 물어봐줘"는 아이 정보를 검색하는 질문(CHILD_INFORMATION_QUERY)이 아니라
// 아이에게 새로 물어봐 달라는 요청이다. 기존에는 이 패턴이 아무 규칙에도 안 걸려
// CHILD_INFORMATION_QUERY로 떨어졌고, RAG가 우연히 관련 기억을 찾으면 부모 요청을
// 아이에게 전달하지도 않은 채 마치 이미 답을 아는 것처럼 대답해버리거나(Dev 실측
// 재현 확인), 기억이 없으면 무관한 고정 문구 제안만 보여줬다 — 두 경우 모두 아이에게
// 실제로 질문이 전달되지 않는다. 부모-아이-신뢰 문제라 최우선으로 검사한다(다른
// 패턴보다 먼저 — "물어봐줘"가 우연히 FEEDBACK/GENERAL 단어를 포함해도 이 의도가 이긴다).
const PARENT_QUERY_REQUEST_PATTERNS = [
  /물어\s*봐/, // "물어봐", "물어봐줘", "물어봐 줄래", "물어봐줄래" 등
  /여쭤\s*봐/,
  /질문\s*해\s*줘/,
  /알아\s*봐\s*줘/,
  /캐물어\s*봐/, // Red 판정 대상 문장("캐물어봐줘")도 라우터로 보내야 한다 — 여기서 걸러내면 안 됨
];

// 피드백·정정 — "방금 답변이 이상했다/다시 답해달라"는 신호를 먼저 확인한다
// (연결확인·인사보다 우선순위가 높다 — 예: "그런 질문에는 잘 들린다고 해야지"는
// 표면적으로 연결확인 단어를 포함하지만 실제로는 직전 답변에 대한 지적이다).
const FEEDBACK_PATTERNS = [
  /그\s*답변/, /방금\s*답변/,
  /왜\s*(같은|똑같은)\s*말/, /똑같은\s*말만/,
  /이상해|잘못됐|틀렸/,
  /해야\s*지/, // "~라고 해야지" — 직전 응답을 정정 요구
  /다시\s*답해/, // "다시 답해 줘"(§10.1 문맥 기반 FEEDBACK) — "다시 말해 줘"(일반대화)와 구분
  /내가\s*묻는\s*말에\s*답해/,
  /안\s*들려\?|안\s*들리니/, // "내 말 안 들려?"류 지적
  /아니[,\s]/,
  /라고\s*했잖아|랬잖아/,
  /날짜가\s*왜|다른\s*날짜/,
  /뭔\s*소리야|무슨\s*소리야/,
];

// 일반 대화 — 인사·감사·연결확인·소소한 확인.
const GENERAL_PATTERNS = [
  /^안녕/, /^하이\b/, /반가워/,
  /고마워|감사해요|감사합니다/,
  /들리[니냐]|들려\s*\?|들리는지|연결.*(되니|돼요|확인)/, // 연결 확인
  /지금\s*대화\s*가능해/,
  /무슨\s*뜻이야/,
  /^다시\s*말해\s*줘|다시\s*설명해\s*줘/, // "다시 답해 줘"와 구분(위 FEEDBACK 우선 매치)
  /오늘\s*기분\s*어때/,
  /너는\s*누구야|넌\s*누구야/,
];

// 케이 정체성 — "너 이름이 뭐야?", "너 누구야?", "케이가 누구야?"
const IDENTITY_PATTERNS = [
  /너(?:는|의|\s*ㄴ)?\s*이름(?:이|은)?\s*(?:뭐|무엇)/,
  /너\s*누구야|넌\s*누구야|너는\s*누구야/,
  /케이(?:가|는)?\s*누구야/,
  /이름이\s*(?:뭐야|뭐니|어떻게\s*돼)/,
];

// 케이 자신·서비스·앱 기능에 대한 질문 (아이와 무관한 질문을 일반 대화로 인정)
// "너 대화 저장 안되니?", "너 업데이트 되니?", "너 뭐 할 수 있어" 등은
// 아이 정보 조회가 아니라 케이/서비스에 대한 일반 대화다.
const SELF_OR_SERVICE_PATTERNS = [
  // 1. 대화 저장 / 기억 / 업데이트 / 대화 불가 등 케이 동작
  /너\s*(?:는|도)?\s*대화\s*저장/,
  /대화\s*저장\s*(?:안\s*(?:되|돼|된|됩)|되|돼|된|됩|가능)/,
  /너\s*(?:는|도)?\s*업데이트\s*(?:되|돼|된|됩|안\s*(?:되|돼|된|됩)|가능)/,
  /업데이트\s*(?:되|돼|된|됩|안\s*(?:되|돼|된|됩)|가능)/,
  /너(?:랑|하고|와)(?:는)?\s*대화가\s*(?:안\s*(?:되|돼|된|됩)|안돼|안된|안됩|힘들|어렵|불가)/,
  /너\s*대화가\s*(?:안\s*(?:되|돼|된|됩)|안돼|안된|안됩)/,
  /대화가\s*안\s*(?:되|돼|된|됩)/,
  // 2. 능력 / 기능 / 사용법
  /너\s*(?:는|도)?\s*(?:뭐|무엇|무얼)\s*(?:할\s*수\s*있|할줄\s*알|할\s*줄\s*알|해|하니|할수있)/,
  /(?:무슨|어떤|무얼|뭐)\s*기능(?:이|은)?\s*(?:있|제공)/,
  /기능(?:이|은)?\s*(?:뭐야|뭐니|무엇|어떤\s*게\s*있|알려)/,
  /(?:어떻게|어찌)\s*(?:쓰는|사용하는|이용하는)(?:\s*거| 거야| 거니| 방법| 법)?/,
  /(?:사용법|이용법|사용\s*방법)(?:이|은)?\s*(?:뭐|어떻게|알려)/,
  // 3. 케이 호칭 + 케이 자신 주어 질문
  /케이\s*너\b/,
  /케이(?:는|가)?\s*(?:뭐|무엇|어떤\s*역할|어떤\s*앱|어떤\s*서비스|누가\s*만들)/,
  // 4. 앱 / 서비스 / 리포트 / 알림 등 플랫폼 기능 질문
  /(?:이|해당)\s*(?:앱|어플|서비스|프로그램)/,
  /(?:앱|서비스)(?:이|은)?\s*(?:뭐야|무엇|어떤)/,
  /(?:일일\s*리포트|주간\s*리포트|리포트)(?:가|는|이|은)?\s*(?:뭐야|무엇|어떻게\s*봐|어디서\s*봐)/,
  /알림\s*(?:어떻게|어디서)?\s*(?:꺼|끄|켜|설정|해제)/,
];

// 짧은 리액션 — 그렇구나 / 알겠어 / 그래 / 응 / 네 / 아하 (왜? 그래? 그건? 정말? 같은 후속 발화는 제외)
const SHORT_REACTION_PATTERNS = [
  /^(?:그렇구나|알겠어|알겠습니다|그래|응|네|아하)[.!?~^;\s]*$/,
];

// 아이 지칭 및 아이 상태/행동 표현 (날짜/요일/시간 질문이 아이 정보 질문으로 오염되는 것을 방지)
const CHILD_REFERENCE_OR_ACTION_PATTERNS = [
  /(?:아이|우리\s*애|우리\s*아이|우리\s*딸|우리\s*아들|딸|아들|서현|서아|애기|자식)/,
  /(?:뭐\s*했|했어|했니|했는지|어땠|어떤|좋아해|놀았|기분|학교|학원|유치원|어린이집)/,
];

// 날짜/요일/시간 사실 질문 (아이와 무관한 순수 사실 질문)
const DATE_TIME_PATTERNS = [
  // 날짜 자체 질문 (예: "오늘 날짜가 뭐야?", "어제 날짜가 몇 일이야?", "내일은 몇 일이야?", "내일은 며칠이야?")
  /(?:오늘|어제|내일|모레|그제|엊그제)?\s*날짜(?:가|는)?\s*(?:뭐|무엇|몇|어떻게|알려)/,
  /(?:오늘|어제|내일|모레|그제|엊그제)(?:은|는|이|가)?\s*(?:몇\s*일|며칠)/,
  /(?:이번\s*달|다음\s*달|지난\s*달|저번\s*달)(?:은|는|이|가)?\s*(?:몇\s*월|무슨\s*달)/,
  /(?:올해|작년|내년)(?:는|은|이|가)?\s*(?:몇\s*년|무슨\s*년)/,
  // 요일 질문 (예: "오늘 무슨 요일이야?", "내일 무슨 요일이야?", "어제 무슨 요일이었어?")
  /(?:오늘|어제|내일|모레|그제|엊그제|이번\s*주|다음\s*주|지난\s*주)?\s*(?:무슨\s*요일|요일이\s*(?:뭐|무엇|어떻게))/,
  // 시간 질문 (예: "지금 몇 시야?", "지금 몇 분이야?", "현재 몇 시야?")
  /(?:지금|현재)\s*(?:몇\s*시|몇\s*분|시간이\s*(?:어떻게|몇\s*시|뭐))/,
];

function isGeneralConversation(text: string): boolean {
  if (GENERAL_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  if (IDENTITY_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  if (SHORT_REACTION_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  if (
    DATE_TIME_PATTERNS.some((p) => p.test(text)) &&
    !CHILD_REFERENCE_OR_ACTION_PATTERNS.some((p) => p.test(text))
  ) {
    return true;
  }
  if (
    SELF_OR_SERVICE_PATTERNS.some((p) => p.test(text)) &&
    !CHILD_REFERENCE_OR_ACTION_PATTERNS.some((p) => p.test(text))
  ) {
    return true;
  }
  return false;
}

// requests/request-parent-k-conversation-context-and-draft-edit-fix.md §5 "강한 후속 신호" —
// 취소 신호를 수정 신호보다 먼저 검사한다("그만 물어봐줘"처럼 두 종류 단어가 섞여도
// 취소 의도가 이겨야 한다).
const PENDING_CANCEL_PATTERNS = [
  /취소해|취소할래|취소\s*할게/,
  /그만\s*할래|그만\s*둘래|그만해/,
  /안\s*(물어봐도|해도)\s*돼|안\s*할래|하지\s*마/,
  /필요\s*없어/,
];

const PENDING_FOLLOWUP_EDIT_PATTERNS = [
  /변경해|바꿔\s*줘|바꿔\s*줄래|바꿔\b/,
  /빼\s*줘|빼고/,
  /그걸로\s*해\s*줘|그걸로\s*할래/,
  /말고/, // "학교 말고 학원으로"
  /조금\s*더|좀\s*더/, // "조금 더 부드럽게 해줘"
  /부드럽게|딱딱해|다르게\s*해/,
];

const NEW_QUERY_PATTERNS = [
  /어제|오늘|그제|엊그제|지난주|이번주|저번주|요즘|평소|최근|그날/,
  /(?:\d{4}\s*년\s*)?\d+\s*월\s*\d+\s*일(?:에)?/,
  /\d+\s*일에/,
  /(?:뭐\s*했|어땠|어떤|무슨|좋아해|기억에\s*남|있었).*\?[.!\s]*$/,
];

export function classifyParentKChatIntent(
  rawText: string,
  hasPendingDraft = false
): IntentClassification {
  const text = rawText.trim();

  // pending 질문 초안이 있으면 후속 수정 의도를 일반 기록 조회보다 먼저 판정한다(§5).
  if (hasPendingDraft) {
    if (PENDING_CANCEL_PATTERNS.some((p) => p.test(text))) {
      return { intent: "PARENT_QUERY_REQUEST_CANCEL", confidence: 0.9 };
    }
    // FEEDBACK/GENERAL 신호가 명확하면 그쪽을 우선한다(예: "안녕", "그 답변 이상해").
    if (!FEEDBACK_PATTERNS.some((p) => p.test(text)) && !isGeneralConversation(text)) {
      if (PENDING_FOLLOWUP_EDIT_PATTERNS.some((p) => p.test(text))) {
        return { intent: "PARENT_QUERY_REQUEST", confidence: 0.9, isFollowUpToPendingDraft: true };
      }
      // 과거(request-parent-k-conversation-context-and-draft-edit-fix.md)에는
      // "부모가 모달에서 최종 확인하므로 안전하다"며 애매한 입력을 catch-all로 전부
      // 초안 수정(PARENT_QUERY_REQUEST, isFollowUpToPendingDraft: true)으로 삼켰다.
      // 그러나 실제로는 일반 대화나 다른 질문이 모두 초안 수정으로 묶여 같은 안내 문구가
      // 반복되고 대화가 영원히 갇히는 심각한 대화 단절 사고가 발생했다.
      // 따라서 명시적 수정 신호(PENDING_FOLLOWUP_EDIT_PATTERNS)가 있을 때만 초안 수정으로 보고,
      // 그 외에는 catch-all 없이 아래쪽 기본 분기로 통과시켜 정상 판정하게 한다.
    }
  }

  if (PARENT_QUERY_REQUEST_PATTERNS.some((p) => p.test(text))) {
    return { intent: "PARENT_QUERY_REQUEST", confidence: 0.9 };
  }

  if (FEEDBACK_PATTERNS.some((p) => p.test(text))) {
    return { intent: "FEEDBACK_OR_CORRECTION", confidence: 0.9 };
  }

  if (isGeneralConversation(text)) {
    return { intent: "GENERAL_CONVERSATION", confidence: 0.9 };
  }

  // 애매하면 기존 안전 경로(아이 정보 질문 → Retrieval)를 그대로 유지한다.
  return { intent: "CHILD_INFORMATION_QUERY", confidence: 0.5 };
}
