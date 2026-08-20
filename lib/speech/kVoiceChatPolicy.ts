export type KChatInputOrigin = "text" | "voice";

interface VoiceTranscriptSendDecision {
  transcript: string;
  sttError: string | null;
  isListening: boolean;
  lastSentTranscript: string;
}

export const normalizeVoiceTranscript = (transcript: string): string =>
  transcript.replace(/\s+/gu, " ").trim();

export const shouldSendFinalVoiceTranscript = ({
  transcript,
  sttError,
  isListening,
  lastSentTranscript,
}: VoiceTranscriptSendDecision): boolean => {
  const finalTranscript = normalizeVoiceTranscript(transcript);
  return !isListening
    && !sttError
    && finalTranscript.length > 0
    && finalTranscript !== lastSentTranscript;
};

/**
 * 음성 질문에만 K 답변을 자동 재생한다(지시서 §9).
 *
 * 답변 텍스트도 함께 본다. 빈 답변을 읽히려 하면 utterance 가 즉시 끝나거나 아예
 * 시작되지 않아 `isSpeaking` 이 켜진 채 남는다 — 버튼이 "정지" 로 굳는다.
 */
export const shouldAutoPlayKAnswer = (
  origin: KChatInputOrigin,
  answerText: string
): boolean => origin === "voice" && answerText.trim().length > 0;

/**
 * K 답변 배선에서 자동재생 판정에 넘길 값을 고른다.
 *
 * 2026-08-20 리뷰 실측 — 화면은 `data.answer || "응답을 가져올 수 없어요."` 로 fallback 을
 * 먼저 씌운 뒤 그 값을 판정에 넘겼다. 그래서 **빈 답변 가드가 무력화됐다.**
 * 답이 없는데 "응답을 가져올 수 없어요" 를 읽어 주는 것은 부모에게 도움이 안 되고,
 * 음성만 켜졌다 꺼져 상태 표시도 어긋난다.
 *
 * 판정은 **API 원본**으로 한다. 화면에 그릴 문구와 읽을지 말지는 다른 판단이다.
 */
export const resolveAutoPlaySource = (rawAnswer: string | null | undefined): string =>
  (rawAnswer ?? "").trim();
