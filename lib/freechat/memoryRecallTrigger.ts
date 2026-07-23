export function isMemoryRecallQuery(text: string): boolean {
  if (!text) return false;
  const normalized = text.replace(/\s+/g, "");

  // 1. 제외 키워드 (방법을 묻는 경우 등)
  const excludePatterns = ["기억나는", "기억나게", "기억하는법", "기억하는방법"];
  if (excludePatterns.some(p => normalized.includes(p))) {
    return false;
  }

  // 의문형 종결 확인 (물음표 또는 ~지, ~니, ~나요 등)
  const isQuestion = text.includes("?") || /[지니]\??$/.test(normalized) || /(나요|가요|까|까요)\??$/.test(normalized);

  // 2. "기억" 관련 표현 + 의문형
  const memoryKeywords = ["기억나", "기억해", "기억하지", "기억나니", "기억하시나요"];
  if (memoryKeywords.some((kw) => normalized.includes(kw)) && isQuestion) {
    return true;
  }

  // 3. 과거 지시 표현 + 의문형
  const pastKeywords = ["저번에", "지난번에", "예전에", "그때내가", "전에내가"];
  if (pastKeywords.some((kw) => normalized.includes(kw)) && isQuestion) {
    return true;
  }

  return false;
}
