import type { SessionStatus } from "@/hooks/useVoiceChat";

export type FreeChatConversationState =
  | "listening"
  | "thinking"
  | "speaking"
  | "connecting"
  | "error"
  | "idle";

type FreeChatConversationStateInput = {
  mode: "voice" | "text";
  status: SessionStatus;
  isRecording: boolean;
  isResponding: boolean;
  isSpeaking: boolean;
};

export const getFreeChatConversationState = ({
  mode,
  status,
  isRecording,
  isResponding,
  isSpeaking,
}: FreeChatConversationStateInput): FreeChatConversationState => {
  // 텍스트 입력에서는 음성 전용 녹음/재생 플래그를 노출하지 않되, 연결 상태와
  // 실제 응답 생성 상태는 아이에게 유의미하므로 그대로 유지한다.
  if (mode === "text") {
    if (status === "error") return "error";
    if (status === "connecting") return "connecting";
    return isResponding ? "thinking" : "idle";
  }

  if (status === "error") return "error";
  if (status === "connecting") return "connecting";
  if (isSpeaking) return "speaking";
  if (isResponding) return "thinking";

  if (isRecording || status === "live") return "listening";

  return "idle";
};
