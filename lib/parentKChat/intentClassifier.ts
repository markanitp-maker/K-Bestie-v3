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
}

export interface AskChildProposalContext {
  proposal: string;
  requestedTopic: string;
}

const CONTEXTUAL_QUERY_REQUEST_PATTERN = /^(그럼|그러면|그렇다면|그걸|그거|직접)(?:\s|,)/;

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
    const suffix = ` (수정 요청: ${currentRequest})`.slice(0, PROPOSAL_MAX_LENGTH);
    const pendingBudget = Math.max(0, PROPOSAL_MAX_LENGTH - suffix.length);
    return {
      proposal: `${pendingProposal.slice(0, pendingBudget)}${suffix}`.slice(0, PROPOSAL_MAX_LENGTH),
      requestedTopic: pendingProposal.slice(0, REQUESTED_TOPIC_MAX_LENGTH),
    };
  }

  const previousUserTurn = [...conversationContext]
    .reverse()
    .find((turn) => turn.role === "user" && turn.text.trim().length > 0);
  if (CONTEXTUAL_QUERY_REQUEST_PATTERN.test(currentRequest) && previousUserTurn) {
    const requestedTopic = previousUserTurn.text.trim().slice(0, REQUESTED_TOPIC_MAX_LENGTH);
    const suffix = `\n현재 요청(우선): ${currentRequest}`.slice(0, PROPOSAL_MAX_LENGTH);
    const prefixLabel = "참고(직전 주제, 확정 아님): ";
    const contextBudget = Math.max(0, PROPOSAL_MAX_LENGTH - suffix.length - prefixLabel.length);
    return {
      proposal: `${prefixLabel}${requestedTopic.slice(0, contextBudget)}${suffix}`.slice(0, PROPOSAL_MAX_LENGTH),
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
    if (!FEEDBACK_PATTERNS.some((p) => p.test(text)) && !GENERAL_PATTERNS.some((p) => p.test(text))) {
      if (PENDING_FOLLOWUP_EDIT_PATTERNS.some((p) => p.test(text))) {
        return { intent: "PARENT_QUERY_REQUEST", confidence: 0.9, isFollowUpToPendingDraft: true };
      }
      // 명시적 후속 신호가 없어도, 새 "물어봐줘"류 요청(완전히 별개의 신규 제안)이
      // 아니라면 애매한 입력은 여전히 "직전 제안에 대한 보충 설명"으로 취급한다
      // (§5) — 어차피 부모가 모달에서 최종 확인해야만 실제 등록되므로 안전하다.
      if (!PARENT_QUERY_REQUEST_PATTERNS.some((p) => p.test(text))) {
        return { intent: "PARENT_QUERY_REQUEST", confidence: 0.6, isFollowUpToPendingDraft: true };
      }
    }
  }

  if (PARENT_QUERY_REQUEST_PATTERNS.some((p) => p.test(text))) {
    return { intent: "PARENT_QUERY_REQUEST", confidence: 0.9 };
  }

  if (FEEDBACK_PATTERNS.some((p) => p.test(text))) {
    return { intent: "FEEDBACK_OR_CORRECTION", confidence: 0.9 };
  }

  if (GENERAL_PATTERNS.some((p) => p.test(text))) {
    return { intent: "GENERAL_CONVERSATION", confidence: 0.9 };
  }

  // 애매하면 기존 안전 경로(아이 정보 질문 → Retrieval)를 그대로 유지한다.
  return { intent: "CHILD_INFORMATION_QUERY", confidence: 0.5 };
}
