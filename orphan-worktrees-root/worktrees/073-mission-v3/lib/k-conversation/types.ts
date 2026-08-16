// K Conversation Engine — 공통 계약 (071 §7~§20 기준).
// 미션/자유대화 Adapter가 함께 참조하는 단일 Source of Truth 타입.
// Engine은 "어떻게 말할지"만 안다 — Goal/Completion/parent_questions/reward 같은
// "무엇을 확보할지"는 Adapter의 adapterContext 밖으로 절대 새어나오지 않는다.

export type ConversationMode = "FREE_CHAT" | "MISSION";

/** 방향만 결정하는 메타 액션. 고정 문구를 만들지 않는다 — 실제 텍스트는 항상
 * responseGenerator가 Action+Persona+발화+Context+History+mode로 Gemini에게 생성시킨다. */
export type ConversationAction =
  | "EMPATHY"
  | "CURIOSITY"
  | "JOKE"
  | "MEMORY_RECALL"
  | "OWN_OPINION"
  | "PLAYFUL_TEASING"
  | "IMAGINATION"
  | "CELEBRATION"
  | "COMFORT"
  | "FOLLOW_UP"
  | "TOPIC_SHIFT"
  | "JUST_LISTEN";

export interface EngineInput {
  childId: string;
  sessionId: string;
  mode: ConversationMode;
  currentUtterance: string;
  /** ASR 신뢰도가 낮으면 규칙 기반 unclear_audio 경로로 결정론적 처리(Gemini 미호출). */
  asrConfidence?: number;
  /** 자동/수동 입력 모드 — Mission/자유대화 공통 세션 UI 상태(비즈니스 목표 아님).
   * "지금 무슨 모드야?" 질문에 정확히 답하기 위해 필요. */
  appMode?: "auto" | "manual";
  /** Adapter 전용 확장 슬롯. Engine 내부 어떤 모듈도 이 값의 존재/내용을 조건 분기에 쓰지 않는다.
   * Mission Adapter가 goal/completion/parent_questions 등을 넘길 때만 사용, Free Chat Adapter는 항상 비운다. */
  adapterContext?: Record<string, unknown>;
  /** true면 currentUtterance가 respond() 호출 전에 이미 chat_messages에 finalized로
   * 저장돼 있다는 뜻 — same-session 조회 결과에 현재 발화가 이미 포함되므로 boredom
   * 판정에서 currentUtterance를 추가로 append하지 않는다. 기본값(undefined/false)은
   * 기존 호출자(Free Chat 등, respond() 전에는 미저장)의 동작을 그대로 유지한다. */
  currentUtteranceAlreadyInSession?: boolean;
}

export type EngineResponseCategory =
  | "safety"        // freeChatReactions 안전검사가 잡음 — Persona/Action 완전히 스킵
  | "deterministic" // unclear_audio/app_mode_question 등 규칙엔진 canned 응답(안전상 결정론 필요)
  | "generated";    // Action+Persona+Context 기반 Gemini 자연생성

export interface EngineOutput {
  text: string;
  action: ConversationAction | null;
  category: EngineResponseCategory;
  safetyFlagged?: boolean;
  safetySubcategory?: string;
  /** 관측/QA용 — 어떤 memory tier가 실제로 프롬프트에 반영됐는지. */
  memoryTiersUsed?: Array<"same_session" | "same_day" | "recent_episode" | "long_term">;
  /** Adapter가 usage_events 등 과금 로그를 남길 수 있도록 노출(Gemini 미호출 경로는 0). */
  tokenIn: number;
  tokenOut: number;
}
