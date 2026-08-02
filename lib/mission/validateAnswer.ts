// 유효답변 판정 (미션 세션 전용 — 자유대화 세션에는 절대 적용하지 않는다)
//
// 1차 구현 휴리스틱:
//   (a) 회피성 문구 블랙리스트에 매칭되면 즉시 무효
//   (b) 그 외에는 최소 글자수(의미있는 한글/텍스트 2자 이상) 이상이면 유효
//
// TODO(고도화): 완벽한 NLP 판정(질문-답변 관련성, 문맥 일치)은 범위 밖.
//   추후 LLM 기반 판정으로 교체할 여지를 남긴다 — 시그니처(text -> ValidateResult)는 유지.
// TODO(연결지점): STT 재확인("네가 말한 게 ○○맞아?")은 대화/프롬프트 레벨 로직으로 별개.
//   재확인이 끝난 최종 확정 답변 텍스트를 이 함수에 넘기는 방식으로 연결한다.

/** 회피성/무효 응답 블랙리스트 (부분 매칭) */
export const EVASIVE_PHRASES: readonly string[] = [
  "몰라",
  "모르겠",
  "그냥",
  "비밀",
  "글쎄",
  "노코멘트",
  "말하기싫",
  "말하기 싫",
  "대답안",
  "대답 안",
  "패스",
  "스킵",
  "없어",
  "없음",
];

/** 질문 이해 실패/설명 요청 문구 (회피보다 우선 검사) */
export const CLARIFICATION_PHRASES: readonly string[] = [
  "무슨 말",
  "무슨 뜻",
  "잘 모르겠",
  "모르겠", // "모르겠어", "몰라"도 기회를 줌
  "몰라",
  "이해", // "이해가 안돼", "이해 안가" 등
  "어려워",
  "다시",
  "쉽게",
  "뭐라고",
  "잘 못 들",
  "그게 뭐",
  "어떻게 말",
  "뭘 말",
  "뭔 말",
];

/** 명확한 거절 문구 (해당 질문 중단 → 상태 'refused' 처리에 참고) */
export const REFUSAL_PHRASES: readonly string[] = [
  "싫어",
  "하기싫어",
  "하기 싫어",
  "안할래",
  "안 할래",
  "그만",
];

export interface ValidateResult {
  valid: boolean;
  /** 무효/거절 사유 (선택) */
  reason?: "evasive" | "too_short" | "empty" | "clarification_needed";
  /** 명확한 거절 여부 (호출부에서 질문 상태를 'refused'로 처리할지 판단) */
  refused?: boolean;
  /** 설명/재질문이 필요한 경우 */
  needsClarification?: boolean;
}

const MIN_MEANINGFUL_LENGTH = 2;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 답변 텍스트의 유효성을 판정한다.
 * @param text 아이의 (STT 재확인까지 끝난) 확정 답변 텍스트
 */
export function validateAnswer(text: string): ValidateResult {
  const raw = (text ?? "").trim();
  if (raw.length === 0) {
    return { valid: false, reason: "empty" };
  }

  const normalized = normalize(raw);

  // 명확한 거절 → 무효 + refused 플래그
  if (REFUSAL_PHRASES.some((p) => normalized.includes(normalize(p)))) {
    return { valid: false, reason: "evasive", refused: true };
  }

  // 이해 실패 / 설명 요청 → 무효 + needsClarification 플래그
  // (모르겠어 등도 일단 한 번 설명 기회를 주도록 evasive보다 우선 처리)
  const stripped = normalized.replace(/[.!?~…\s]/g, "");
  // 문장 어디에 있어도 매칭하되(끝에 오는 "질문이 어려워" 같은 경우도 잡아야 하므로
  // startsWith만으로는 부족), 전체 발화 길이가 트리거 문구와 비슷할 때만 매칭한다 —
  // 그래야 "이따가 다시 놀이터 갈 거야"처럼 트리거 단어가 무관한 긴 문장에 우연히
  // 섞여 있는 유효한 답변까지 오분류하지 않는다.
  const needsClarification = CLARIFICATION_PHRASES.some((p) => {
    const np = normalize(p).replace(/\s/g, "");
    return stripped === np || (stripped.includes(np) && stripped.length <= np.length + 4);
  });
  if (needsClarification) {
    return { valid: false, reason: "clarification_needed", needsClarification: true };
  }

  // 회피성 문구 → 무효 (공백/문장부호 제거 후 회피 문구만 남으면 회피로 간주)
  const isEvasive = EVASIVE_PHRASES.some((p) => {
    const np = normalize(p).replace(/\s/g, "");
    return stripped === np || stripped.startsWith(np) && stripped.length <= np.length + 2;
  });
  if (isEvasive) {
    return { valid: false, reason: "evasive" };
  }

  // 최소 의미 글자수 미달 → 무효
  const meaningful = raw.replace(/[^가-힣a-zA-Z0-9]/g, "");
  if (meaningful.length < MIN_MEANINGFUL_LENGTH) {
    return { valid: false, reason: "too_short" };
  }

  return { valid: true };
}
