export interface VacationChatInstructionResult {
  instruction: string | undefined;
  markAskedRequired: boolean;
}

/**
 * 아이가 방학 중이거나 학교에 가지 않는 상황을 언급했는지 감지하는 판정 함수
 * 예: "방학이라서 학교 안 갔어", "지금 방학이야", "학교 안 가", "개학 안 했어", "여름방학이야" 등
 */
export function isChildMentioningVacationOrNoSchool(childText: string): boolean {
  return /(방학|여름\s*방학|겨울\s*방학|봄\s*방학)|(학교\s*(안\s*가|안\s*갔|안가|안갔|쉬|안\s*다녀))|(개학\s*(안\s*했|아직))/.test(
    childText
  );
}

/**
 * 아이가 학교나 개학을 언급했는지 감지하는 판정 함수 (개학 확인 질문 트리거용)
 * 예: "오늘 학교 갔다왔어", "학교 다녀왔어", "개학했어", "오늘 개학이야" 등
 */
export function isChildMentioningSchoolOrSchoolStart(childText: string): boolean {
  return /(학교|개학)/.test(childText);
}

export function resolveVacationChatInstruction(
  childText: string,
  vacationBlockState: {
    blocked: boolean;
    needsSchoolStartDateQuestion: boolean;
    needsSchoolStartConfirmationQuestion: boolean;
  }
): VacationChatInstructionResult {
  // 학기 중 (blocked === false)인 경우 아무 지침도 내리지 않음
  if (!vacationBlockState.blocked) {
    return { instruction: undefined, markAskedRequired: false };
  }

  // 1. 아이가 "개학 몰라 / 학교 얘기 그만해 / 왜 자꾸 학교 물어봐" 등 모름/거부 반응을 보인 경우
  const isUnknownOrRefusal =
    /개학.*(몰라|모르|기억\s*안|안\s*알려|언젠지\s*몰라)|(학교|개학).*(그만|자꾸|왜|하지\s*마|묻지\s*마)|(날짜|개학일)\s*몰라/.test(
      childText
    );

  if (isUnknownOrRefusal) {
    return {
      instruction: `[방학 대화 지침]\n- 아이가 개학 날짜를 모르거나 학교 질문을 부담스러워하므로 개학/학교에 대해 더 이상 묻지 마.\n- 현재 방학 기간임을 기억하고 일상적인 대화와 아이가 하고 싶은 이야기에 집중해줘.`,
      markAskedRequired: true,
    };
  }

  // 2. 개학일 질문이 필요한 상태(needsSchoolStartDateQuestion)이지만,
  // 오직 아이가 방학 또는 학교 안 감을 직접 언급했을 때만 개학 질문을 던진다.
  if (vacationBlockState.needsSchoolStartDateQuestion && isChildMentioningVacationOrNoSchool(childText)) {
    return {
      instruction: `[방학/개학 대화 지침]\n- 아이가 방학이거나 학교에 가지 않는다고 언급했어.\n- 아이가 한 말에 먼저 "아 방학이구나!"처럼 자연스럽게 공감/반응해줘.\n- 이어서 "그럼 개학은 언제야? 그때까지는 학교 얘기 안 물어볼게!"처럼 개학 날짜를 또래 친구처럼 다정하게 물어봐줘.`,
      markAskedRequired: true,
    };
  }

  // 3. 개학 확인 질문이 필요한 상태(needsSchoolStartConfirmationQuestion)이지만,
  // 오직 아이가 학교나 개학을 직접 언급했을 때만 개학 확인 질문을 던진다.
  if (vacationBlockState.needsSchoolStartConfirmationQuestion && isChildMentioningSchoolOrSchoolStart(childText)) {
    return {
      instruction: `[개학 확인 대화 지침]\n- 오늘이 예상 개학일이야.\n- 아이가 방금 학교/개학에 대해 한 말에 먼저 다정하게 반응해줘.\n- 대화 흐름에 맞추어 "오늘이 개학하는 날이라고 들었는데 오늘 학교 갔어?"처럼 학교에 다녀왔는지 또래 친구처럼 자연스럽게 확인해봐.`,
      markAskedRequired: true,
    };
  }

  // 4. 그 외의 모든 경우 (인사 "안녕", 일상 대화 "게임했어", 또는 아이의 방학 언급이 없는 경우):
  // 뜬금없이 개학을 묻지 않고, 학교 질문을 차단하는 기본 방학 지침만 전달한다.
  return {
    instruction: `[방학 대화 지침]\n- 현재 방학 기간이야. 오늘 학교 갔냐거나 학교 수업/숙제 질문은 하지 말고, 방학 일상에 맞춰 이야기해줘.`,
    markAskedRequired: false,
  };
}
