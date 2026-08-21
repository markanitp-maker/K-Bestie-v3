export type KChatInputOrigin = "text" | "voice";
export type KVoiceMode = "typing" | "hands-free";

export const MAX_HANDS_FREE_STT_ERRORS = 3;

interface HandsFreeResumeDecision {
  mode: KVoiceMode;
  isMounted: boolean;
  isLoading: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  sttErrorCount: number;
  maxSttErrors?: number;
}

interface VoiceTranscriptSendDecision {
  mode: KVoiceMode;
  transcript: string;
  sttError: string | null;
  isListening: boolean;
  lastSentTranscript: string;
}

export const normalizeVoiceTranscript = (transcript: string): string =>
  transcript.replace(/\s+/gu, " ").trim();

/**
 * final transcript 를 K 에게 보낼지 판정한다.
 *
 * **`mode` 검사가 먼저다(034-R1 리뷰 반려, 2026-08-21).** 채팅 모드는 "키보드 입력만" 이라
 * STT 결과가 흘러 들어가면 안 된다. 그런데 이 판정은 `isListening` 이 false 로 **떨어질 때**
 * 깨어나고, 음성대화 → 채팅 전환이 부르는 `stopHandsFree()` 가 바로 그 false 를 만든다.
 * 즉 마이크 버튼을 숨기는 것만으로는 막지 못한다 — 전환 직전에 확정된 발화가 전환 **후에**
 * 전송되는 경합이 남는다. 그래서 모드를 여기서 본다.
 */
export const shouldSendFinalVoiceTranscript = ({
  mode,
  transcript,
  sttError,
  isListening,
  lastSentTranscript,
}: VoiceTranscriptSendDecision): boolean => {
  if (mode !== "hands-free") return false;
  const finalTranscript = normalizeVoiceTranscript(transcript);
  return !isListening
    && !sttError
    && finalTranscript.length > 0
    && finalTranscript !== lastSentTranscript;
};

/**
 * K 답변 자동 재생 여부. **기준은 모드다. 질문 경로가 아니다.**
 *
 * 034-R1 대표 확정(2026-08-21): `채팅` 과 `음성대화` 를 모드 기준으로 완전히 분리한다.
 * 채팅 모드에는 마이크·STT·자동 TTS 가 아예 없고, 음성대화 모드에서만 동작한다.
 *
 * 그 전에는 질문 경로(origin)로 갈랐다 — 채팅 모드에서 마이크로 물으면 답을 읽어 줬다.
 * 그 동작은 지시서 §21 "채팅 모드 K 답변 자동 TTS 금지" 와 어긋나서 폐기됐다.
 * origin 인자를 다시 넣지 마라.
 *
 * 답변 텍스트도 함께 본다. 빈 답변을 읽히려 하면 utterance 가 즉시 끝나거나 아예
 * 시작되지 않아 `isSpeaking` 이 켜진 채 남는다 — 버튼이 "정지" 로 굳는다.
 */
export const shouldAutoPlayKAnswer = (
  mode: KVoiceMode,
  answerText: string
): boolean => mode === "hands-free" && answerText.trim().length > 0;

export const shouldResumeHandsFree = ({
  mode,
  isMounted,
  isLoading,
  isListening,
  isSpeaking,
  sttErrorCount,
  maxSttErrors = MAX_HANDS_FREE_STT_ERRORS,
}: HandsFreeResumeDecision): boolean => mode === "hands-free"
  && isMounted
  && !isLoading
  && !isListening
  && !isSpeaking
  && sttErrorCount < maxSttErrors;

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
