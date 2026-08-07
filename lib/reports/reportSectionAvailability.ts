export const REPORT_SECTION_KEYS = [
  "school_academy_life",
  "peer_friendship",
  "emotion_hint",
  "interests_preferences",
  "study_concerns",
  "digital_content_interests",
  "future_dreams",
  "teacher_adults",
  "recurring_stories",
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

const REPORT_SECTION_DEFINITIONS: ReadonlyArray<{
  key: ReportSectionKey;
  title: string;
  aliases: readonly string[];
}> = [
  { key: "school_academy_life", title: "학교·학원 생활", aliases: ["school_life"] },
  { key: "peer_friendship", title: "친구 관계와 또래 생활", aliases: ["peer_relations"] },
  { key: "emotion_hint", title: "감정 힌트 / 마음 흐름", aliases: ["emotional_state"] },
  { key: "interests_preferences", title: "관심사와 개인 취향", aliases: ["interests"] },
  { key: "study_concerns", title: "공부 고민", aliases: [] },
  { key: "digital_content_interests", title: "디지털 관심사와 콘텐츠 취향", aliases: ["digital_interests"] },
  { key: "future_dreams", title: "미래·진로·꿈", aliases: [] },
  { key: "teacher_adults", title: "선생님·어른", aliases: [] },
  { key: "recurring_stories", title: "반복되는 이야기", aliases: [] },
];

const PLACEHOLDER_TEXTS = new Set([
  "이 항목은 확인할 대화가 충분하지 않아요",
  "확인할 대화가 충분하지 않아요",
  "대화 정보 부족",
  "데이터 부족",
  "정보 없음",
  "확인된 내용이 없어요",
  "분석을 준비 중이에요",
  "분석이 준비 중입니다",
  "상세 분석이 준비 중입니다",
  "대화 요약이 준비 중입니다",
  "대화 실마리가 준비 중입니다",
  "새로운 이야기가 있어요",
  "새로운 소식이 있어요",
  "오늘은 관련 기록이 없어요",
  "생성된 질문 가이드가 아직 없습니다",
]);

function normalizeForAvailability(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[.!?。！？]+$/gu, "")
    .trim();
}

export function meaningfulReportSectionContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const displayValue = value.trim();
  if (!displayValue) return null;

  const normalized = normalizeForAvailability(displayValue);
  if (!normalized || PLACEHOLDER_TEXTS.has(normalized)) return null;
  return displayValue;
}

export function isMeaningfulReportSection(value: unknown): value is string {
  return meaningfulReportSectionContent(value) !== null;
}

export function reportSectionValueForStorage(value: unknown): string {
  return meaningfulReportSectionContent(value) ?? "";
}

export function sanitizeReportSectionRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const content = meaningfulReportSectionContent(raw);
    if (content !== null) result[key] = content;
  }
  return result;
}

export function buildMeaningfulReportSections(
  source: Record<string, unknown> | null | undefined,
): Array<{ key: ReportSectionKey; title: string; body: string }> {
  const record = source ?? {};
  return REPORT_SECTION_DEFINITIONS.flatMap(({ key, title, aliases }) => {
    for (const candidateKey of [key, ...aliases]) {
      const body = meaningfulReportSectionContent(record[candidateKey]);
      if (body !== null) return [{ key, title, body }];
    }
    return [];
  });
}
