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
  // 텍스트 입력에서는 음성 세션의 연결/녹음/재생 플래그를 화면 상태로 노출하지
  // 않는다. 아이가 전송한 뒤 K의 응답을 만드는 동안만 thinking, 그 외에는 idle이다.
  if (mode === "text") return isResponding ? "thinking" : "idle";

  if (status === "error") return "error";
  if (status === "connecting") return "connecting";
  if (isSpeaking) return "speaking";
  if (isResponding) return "thinking";

  if (isRecording || status === "live") return "listening";

  return "idle";
};
