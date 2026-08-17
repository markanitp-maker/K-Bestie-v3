import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveVacationChatInstruction,
  isChildMentioningVacationOrNoSchool,
  isChildMentioningSchoolOrSchoolStart,
} from "@/lib/freechat/vacationChatInstruction";
import {
  resolveSchoolQuestionBlockState,
  VacationContext,
} from "@/lib/plan/vacationSchoolContext";

test("1. '안녕' / '반가워' → 개학 질문이 나가지 않는다 (핵심)", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: true,
    needsSchoolStartConfirmationQuestion: false,
  };

  const greetings = ["안녕", "반가워", "안녕?", "케이 안녕!"];
  for (const greeting of greetings) {
    const result = resolveVacationChatInstruction(greeting, vacationBlockState);
    assert.ok(result.instruction, `[${greeting}] instruction이 존재해야 함`);
    assert.equal(
      result.markAskedRequired,
      false,
      `[${greeting}] 개학 질문을 던지지 않으므로 markAskedRequired는 false여야 함`
    );
    assert.ok(
      !result.instruction.includes("개학은 언제"),
      `[${greeting}] 개학 질문이 포함되어서는 안 됨`
    );
    assert.ok(
      result.instruction.includes("학교 수업/숙제 질문은 하지 말고, 방학 일상에 맞춰 이야기해줘"),
      `[${greeting}] 기본 방학 일상 대화 지침이어야 함`
    );
  }
});

test("2. 일상 대화('오늘 게임했어') → 개학 질문 없음", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: true,
    needsSchoolStartConfirmationQuestion: false,
  };

  const dailyUtterances = ["오늘 게임했어", "오늘 축구 골 넣었어!", "나 지금 밥 먹고 있어", "심심해"];
  for (const utterance of dailyUtterances) {
    const result = resolveVacationChatInstruction(utterance, vacationBlockState);
    assert.ok(result.instruction, `[${utterance}] instruction이 존재해야 함`);
    assert.equal(
      result.markAskedRequired,
      false,
      `[${utterance}] 개학 질문을 던지지 않으므로 markAskedRequired는 false여야 함`
    );
    assert.ok(
      !result.instruction.includes("개학은 언제"),
      `[${utterance}] 개학 질문이 포함되어서는 안 됨`
    );
    assert.ok(
      result.instruction.includes("방학 일상에 맞춰 이야기해줘"),
      `[${utterance}] 기본 방학 일상 지침이어야 함`
    );
  }
});

test("3. '방학이라서 학교 안 갔어' → 개학 질문이 나간다 (핵심)", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: true,
    needsSchoolStartConfirmationQuestion: false,
  };

  const result = resolveVacationChatInstruction("방학이라서 학교 안 갔어", vacationBlockState);
  assert.ok(result.instruction, "instruction이 존재해야 함");
  assert.equal(result.markAskedRequired, true, "개학 질문을 던지므로 markAskedRequired는 true여야 함");
  assert.ok(
    result.instruction.includes("그럼 개학은 언제야? 그때까지는 학교 얘기 안 물어볼게!"),
    "개학 날짜 질문 지침이 포함되어야 함"
  );
  assert.ok(
    result.instruction.includes("아이가 방학이거나 학교에 가지 않는다고 언급했어"),
    "방학 언급에 대한 반응 지침이 포함되어야 함"
  );
});

test("4. '지금 방학이야' / '학교 안 가' / '개학 안 했어' → 개학 질문이 나간다", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: true,
    needsSchoolStartConfirmationQuestion: false,
  };

  const vacationUtterances = [
    "지금 방학이야",
    "학교 안 가",
    "개학 안 했어",
    "나 여름방학이야",
    "오늘 학교 쉬는 날이야 방학이라",
  ];

  for (const utterance of vacationUtterances) {
    const result = resolveVacationChatInstruction(utterance, vacationBlockState);
    assert.ok(result.instruction, `[${utterance}] instruction이 존재해야 함`);
    assert.equal(result.markAskedRequired, true, `[${utterance}] markAskedRequired는 true여야 함`);
    assert.ok(
      result.instruction.includes("그럼 개학은 언제야? 그때까지는 학교 얘기 안 물어볼게!"),
      `[${utterance}] 개학 질문 지침이 포함되어야 함`
    );
  }
});

test("5. 아이가 '개학 언제인지 몰라'라고 답한 뒤 다시 묻지 않는다", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: true,
    needsSchoolStartConfirmationQuestion: false,
  };

  const unknownUtterances = [
    "개학 언제인지 나도 몰라",
    "너 왜 자꾸 학교 물어 보니 개학 언젠지 나도 몰라",
    "개학 몰라",
    "개학일 몰라",
    "학교 얘기 그만해",
    "학교 왜 자꾸 묻지 마",
  ];

  for (const utterance of unknownUtterances) {
    const result = resolveVacationChatInstruction(utterance, vacationBlockState);
    assert.equal(result.markAskedRequired, true, `[${utterance}] 당일 재질문 차단을 위해 markAskedRequired는 true여야 함`);
    assert.ok(
      result.instruction?.includes("개학/학교에 대해 더 이상 묻지 마"),
      `[${utterance}] 개학/학교에 대해 더 이상 묻지 말라는 지침이어야 함`
    );
    assert.ok(
      !result.instruction?.includes("그럼 개학은 언제야?"),
      `[${utterance}] 개학을 또 묻는 지침이 포함되어서는 안 됨`
    );
  }
});

test("6. 학기 중(SEMESTER) → 이 경로가 안 탄다", () => {
  const semesterContext: VacationContext = {
    id: "test-semester-1",
    child_id: "child-1",
    context_type: "vacation_school",
    status: "SEMESTER",
    expected_school_start_date: null,
    school_question_block_until: null,
    confirmation_status: null,
    last_asked_business_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expired_at: null,
  };

  const blockState = resolveSchoolQuestionBlockState(semesterContext, "2026-08-17");
  assert.equal(blockState.blocked, false);
  assert.equal(blockState.needsSchoolStartDateQuestion, false);
  assert.equal(blockState.needsSchoolStartConfirmationQuestion, false);

  const result = resolveVacationChatInstruction("안녕 오늘 학교 재미있었어", blockState);
  assert.equal(result.instruction, undefined, "학기 중에는 adapterInstruction이 undefined여야 함");
  assert.equal(result.markAskedRequired, false);
});

test("7. 방학 중 학교 질문 차단은 그대로 동작한다", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: false,
    needsSchoolStartConfirmationQuestion: false,
  };

  const result = resolveVacationChatInstruction("내일 뭐 해?", vacationBlockState);
  assert.ok(result.instruction, "instruction이 존재해야 함");
  assert.ok(
    result.instruction.includes("현재 방학 기간이야"),
    "방학 기간 맥락이 포함되어야 함"
  );
  assert.ok(
    result.instruction.includes("학교 수업/숙제 질문은 하지 말고, 방학 일상에 맞춰 이야기해줘"),
    "학교 질문 방지 및 방학 일상 지침이 포함되어야 함"
  );
  assert.equal(result.markAskedRequired, false);
});

test("8. 개학 확인 질문도 아이 언급 없이는 안 나간다", () => {
  const vacationBlockState = {
    blocked: true,
    needsSchoolStartDateQuestion: false,
    needsSchoolStartConfirmationQuestion: true,
  };

  // 1) 아이가 학교/개학 언급이 없는 경우 -> 개학 확인 질문 나가지 않음
  const nonSchoolUtterances = ["안녕 오늘 너무 덥다", "안녕", "오늘 게임했어"];
  for (const utterance of nonSchoolUtterances) {
    const resultNoMention = resolveVacationChatInstruction(utterance, vacationBlockState);
    assert.ok(resultNoMention.instruction, `[${utterance}] instruction 존재`);
    assert.equal(
      resultNoMention.markAskedRequired,
      false,
      `[${utterance}] 아이 언급 없이는 markAskedRequired가 false여야 함`
    );
    assert.ok(
      !resultNoMention.instruction.includes("오늘이 개학하는 날이라고 들었는데 오늘 학교 갔어?"),
      `[${utterance}] 개학 확인 질문이 포함되지 않아야 함`
    );
    assert.ok(
      resultNoMention.instruction.includes("방학 일상에 맞춰 이야기해줘"),
      `[${utterance}] 기본 방학 지침이어야 함`
    );
  }

  // 2) 아이가 학교/개학을 언급한 경우 -> 개학 확인 질문 나감
  const schoolMentionUtterances = ["오늘 학교 갔다왔어", "오늘 개학했어", "학교 다녀왔어"];
  for (const utterance of schoolMentionUtterances) {
    const resultWithMention = resolveVacationChatInstruction(utterance, vacationBlockState);
    assert.ok(resultWithMention.instruction, `[${utterance}] instruction 존재`);
    assert.equal(
      resultWithMention.markAskedRequired,
      true,
      `[${utterance}] 학교/개학 언급 시 markAskedRequired가 true여야 함`
    );
    assert.ok(
      resultWithMention.instruction.includes("오늘이 개학하는 날이라고 들었는데 오늘 학교 갔어?"),
      `[${utterance}] 개학 확인 질문 가이드가 포함되어야 함`
    );
  }
});
