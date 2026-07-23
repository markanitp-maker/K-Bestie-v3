// A~E 대화방식 = 공통 미션 오케스트레이터(mission/start·answer·respond + golden key RPC) 위의
// '표현/전송 전략'이다. 오케스트레이터(질문순서·유효답변·진행률·완료·황금열쇠)는 절대 복제하지 않고,
// 아래 전략 설정만 모드별로 달라진다(Plan01 §4). A~E 엔진은 다음 질문을 임의 결정하지 않는다.
//
//   transport      : 아이 발화 → answerText 획득 + 케이 응답 전달 방식
//                    'text'     = STT→LLM→텍스트 (E안, 케이 음성 없음)
//                    'pipeline' = STT→LLM→TTS   (C·D안)
//                    'live'     = Gemini Live Native Audio (A·B안)
//   useTTS         : 케이 음성(TTS/Live audio) 출력 여부 (E안만 false)
//   showChildBubble: 아이 말풍선 표시 여부. false여도(B·D) 아이 발화 저장·유효성·진행률·리포트·usage_events는 유지.
//
// conversation_mode는 usage_events 태깅 값(§23)과 동일한 A~E enum이다.

import type { ConversationMode } from "@/lib/plan/conversationMode";

export type Transport = "text" | "pipeline" | "live";

export interface ModeStrategy {
  mode: ConversationMode;
  transport: Transport;
  useTTS: boolean;
  showChildBubble: boolean;
  /** Live 경로 여부(A·B) — barge-in/재연결 등 Live 전용 처리 분기용. */
  isLive: boolean;
  label: string;
}

export const MODE_STRATEGY: Record<ConversationMode, ModeStrategy> = {
  A: { mode: "A", transport: "live",     useTTS: true,  showChildBubble: true,  isLive: true,  label: "Live · 양쪽 말풍선" },
  B: { mode: "B", transport: "live",     useTTS: true,  showChildBubble: false, isLive: true,  label: "Live · 아이 말풍선 숨김" },
  C: { mode: "C", transport: "pipeline", useTTS: true,  showChildBubble: true,  isLive: false, label: "STT·LLM·TTS · 양쪽 말풍선" },
  D: { mode: "D", transport: "pipeline", useTTS: true,  showChildBubble: false, isLive: false, label: "STT·LLM·TTS · 아이 말풍선 숨김" },
  E: { mode: "E", transport: "text",     useTTS: false, showChildBubble: true,  isLive: false, label: "STT·LLM · 텍스트 채팅" },
};

export function getModeStrategy(mode: ConversationMode): ModeStrategy {
  return MODE_STRATEGY[mode];
}
