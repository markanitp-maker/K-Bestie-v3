// A~F 대화방식(conversation_mode) 단일 소스 — usage_events 태깅/집계/필터/내보내기/관리자 UI가 공유한다.
// Plan01 §4/§23. A~F UI가 아직 구현 전이라 현재 기록되는 이벤트는 대부분 mode 미지정(=미분류)이다.
//   - A: Live API + 아이 말풍선 표시
//   - B: Live API + 아이 말풍선 미표시
//   - C: STT+LLM+TTS + 아이 말풍선 표시
//   - D: STT+LLM+TTS + 아이 말풍선 미표시
//   - E: STT+LLM 텍스트 채팅(케이 음성 없음)
//   - F: STT+LLM 텍스트 채팅(케이 음성 없음) + 아이 말풍선 미표시

export const CONVERSATION_MODES = ["A", "B", "C", "D", "E", "F"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** 집계/표시에서 mode 미지정 이벤트를 담는 버킷 키. DB에는 NULL로 저장되고, 화면에는 '미분류'로 노출한다. */
export const UNCLASSIFIED_MODE = "unclassified" as const;
export type ModeBucket = ConversationMode | typeof UNCLASSIFIED_MODE;

export const MODE_LABELS: Record<ModeBucket, string> = {
  A: "A안 (Live·아이말풍선)",
  B: "B안 (Live·아이말풍선 없음)",
  C: "C안 (STT·LLM·TTS·아이말풍선)",
  D: "D안 (STT·LLM·TTS·아이말풍선 없음)",
  E: "E안 (음성입력·텍스트채팅)",
  F: "F안 (음성입력·텍스트채팅·아이말풍선 없음)",
  unclassified: "미분류",
};

/** 임의 입력을 유효한 A~E 값으로 정규화. 유효하지 않으면 null(=미분류 저장). 보안 경계가 아닌 원가 라벨이다. */
export function normalizeConversationMode(value: unknown): ConversationMode | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return (CONVERSATION_MODES as readonly string[]).includes(v) ? (v as ConversationMode) : null;
}

/** NULL/미지정 이벤트를 'unclassified' 버킷으로 매핑. */
export function toModeBucket(value: unknown): ModeBucket {
  return normalizeConversationMode(value) ?? UNCLASSIFIED_MODE;
}

/** 집계용 전체 버킷 키(표·필터 순서 고정). */
export const ALL_MODE_BUCKETS: ModeBucket[] = [...CONVERSATION_MODES, UNCLASSIFIED_MODE];
