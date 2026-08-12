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
  /** true면 현재 발화가 Engine 호출 전에 same-session 저장소에 들어간 Adapter다.
   * 조회 결과의 마지막 발화가 실제로 일치할 때만 중복을 제거하며, 조회 실패·순서 경합
   * 때도 현재 발화 자체가 boredom 판정에서 빠지지 않도록 항상 다시 추가한다. */
  currentUtteranceAlreadyInSession?: boolean;
  /** ASR 신뢰도가 낮으면 규칙 기반 unclear_audio 경로로 결정론적 처리(Gemini 미호출). */
  asrConfidence?: number;
  /** 자동/수동 입력 모드 — Mission/자유대화 공통 세션 UI 상태(비즈니스 목표 아님).
   * "지금 무슨 모드야?" 질문에 정확히 답하기 위해 필요. */
  appMode?: "auto" | "manual";
  /** Adapter 전용 확장 슬롯. Engine 내부 어떤 모듈도 이 값의 존재/내용을 조건 분기에 쓰지 않는다.
   * Mission Adapter가 goal/completion/parent_questions 등을 넘길 때만 사용, Free Chat Adapter는 항상 비운다. */
  adapterContext?: Record<string, unknown>;
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
  /** Mission Adapter가 무보상 조기 종료를 결정할 수 있도록 공통 엔진의 다중턴 판정을 전달한다. */
  boredom?: import("./boredomDetection").BoredomAssessment;
  /** Adapter가 usage_events 등 과금 로그를 남길 수 있도록 노출(Gemini 미호출 경로는 0). */
  tokenIn: number;
  tokenOut: number;
}
