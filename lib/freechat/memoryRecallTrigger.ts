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

  // 4. (2026-08-03 확장) 인용/전언 표현 + 의문형 — "기억"/"저번에" 같은 명시적
  // 키워드 없이도 "~라고 했지?", "~다고 한 게 뭐였지?"처럼 이전에 말한 내용을
  // 되묻는 자연스러운 질문형을 잡는다(requests/064 E2E에서 실측 발견: 지시서
  // 자체의 예시 질문 절반이 기존 키워드 게이트를 통과하지 못함). "다고/라고" +
  // "했/한" 조합은 "이전에 말한 것을 회상"하는 신호로 비교적 안전하다 —
  // "~하는 법 알려줘"류 방법 질문과는 문형이 다르고, 위 1번 제외 키워드로도
  // 이미 걸러진다.
  const reportedSpeechPattern = /(다고|라고)(했|한)/;
  if (reportedSpeechPattern.test(normalized) && isQuestion) {
    return true;
  }

  return false;
}
