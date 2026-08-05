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

  // 5. (066-llm-wiki QA에서 실측 발견) "내가 ~ 뭐지?/뭐야?/은?/는?"처럼 "기억"·"저번에"·
  // "~다고 했" 같은 명시적 키워드 없이 자기 자신의 정보(선호·특성 등)를 되묻는 자연스러운
  // 질문형("내가 싫어하는 과일이 뭐지?", "내가 먹고 싶은 과일은?")은 기존 규칙 어디에도
  // 걸리지 않아 전부 놓치고 있었다. "내가"로 시작해 의문사를 포함하거나, 의문사 없이도
  // "은?/는?"으로 끝나는 형태(한국어에서 "~은 뭐야?"의 "뭐야"가 자연스럽게 생략된 형태)를
  // 추가로 잡는다. 실제로 관련 기억이 없으면 generateMemoryRecallResponse가 null을 반환해
  // 기존 일반 대화 흐름으로 그대로 폴백되므로(하드코딩 응답 없음), 과다 트리거의 위험은 낮다.
  //
  // claude-review 지적: "내가"와 의문사 사이에 길이 제한이 없어 "내가 어제 떡볶이
  // 먹었는데 너는 뭐 좋아해?"처럼 절이 바뀌어 상대(케이)의 취향을 묻는 문장까지 오탐
  // 했다. "내가"~의문사 사이를 같은 절로 좁히기 위해 (a) 12자 이내로 거리를 제한하고
  // (b) 그 사이에 "너"/"케이"(주어 전환 신호)가 없어야 한다는 조건을 추가한다.
  const NO_TOPIC_SWITCH_GAP = "(?:(?!너|케이)[\\s\\S]){0,12}";
  const selfReferentialWhPattern = new RegExp(`내가${NO_TOPIC_SWITCH_GAP}(뭐|무엇|누구|어디|언제|어떤|얼마나|몇)`);
  const selfReferentialElidedPattern = new RegExp(`내가${NO_TOPIC_SWITCH_GAP}(은|는)\\??$`);
  if ((selfReferentialWhPattern.test(normalized) || selfReferentialElidedPattern.test(normalized)) && isQuestion) {
    return true;
  }

  return false;
}
