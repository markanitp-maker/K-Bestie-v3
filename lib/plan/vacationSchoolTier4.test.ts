import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSchoolQuestionBlockState,
  getVacationFollowUpQuestion,
  getSchoolStartConfirmationQuestion,
  VacationContext,
} from "./vacationSchoolContext";

test("resolveSchoolQuestionBlockState - VACATION_UNCONFIRMED behavior", () => {
  const context: VacationContext = {
    id: "test-ctx-1",
    child_id: "child-1",
    context_type: "vacation_school",
    status: "VACATION_UNCONFIRMED",
    expected_school_start_date: null,
    school_question_block_until: null,
    confirmation_status: null,
    last_asked_business_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expired_at: null,
  };

  // 1. 방학 선언 직후 (last_asked_business_date === null)
  const res1 = resolveSchoolQuestionBlockState(context, "2026-08-06");
  assert.equal(res1.blocked, true);
  assert.equal(res1.needsSchoolStartDateQuestion, true);
  assert.equal(res1.needsSchoolStartConfirmationQuestion, false);

  // 2. 질문 한 후 (last_asked_business_date === "2026-08-06")
  context.last_asked_business_date = "2026-08-06";
  const res2 = resolveSchoolQuestionBlockState(context, "2026-08-06");
  assert.equal(res2.blocked, true);
  assert.equal(res2.needsSchoolStartDateQuestion, false);
  assert.equal(res2.needsSchoolStartConfirmationQuestion, false);

  // 3. 다음 날 (last_asked_business_date !== "2026-08-07")
  const res3 = resolveSchoolQuestionBlockState(context, "2026-08-07");
  assert.equal(res3.blocked, true);
  assert.equal(res3.needsSchoolStartDateQuestion, true);
  assert.equal(res3.needsSchoolStartConfirmationQuestion, false);
});

test("resolveSchoolQuestionBlockState - VACATION_CONFIRMED & SCHOOL_START_CONFIRMATION_DUE behavior", () => {
  const context: VacationContext = {
    id: "test-ctx-2",
    child_id: "child-1",
    context_type: "vacation_school",
    status: "VACATION_CONFIRMED",
    expected_school_start_date: "2026-08-20",
    school_question_block_until: "2026-08-19",
    confirmation_status: null,
    last_asked_business_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expired_at: null,
  };

  // 1. 개학일 전 (2026-08-10) -> 학교 질문 차단, 후속 질문 없음
  const resBefore = resolveSchoolQuestionBlockState(context, "2026-08-10");
  assert.equal(resBefore.blocked, true);
  assert.equal(resBefore.needsSchoolStartDateQuestion, false);
  assert.equal(resBefore.needsSchoolStartConfirmationQuestion, false);

  // 2. 개학일 당일 (2026-08-20) -> 개학 여부 확인 질문 필요
  const resOn = resolveSchoolQuestionBlockState(context, "2026-08-20");
  assert.equal(resOn.blocked, true);
  assert.equal(resOn.needsSchoolStartDateQuestion, false);
  assert.equal(resOn.needsSchoolStartConfirmationQuestion, true);

  // 3. 개학일 당일 질문 완료 후 -> 오늘 중복 질문 없음
  context.last_asked_business_date = "2026-08-20";
  const resAsked = resolveSchoolQuestionBlockState(context, "2026-08-20");
  assert.equal(resAsked.blocked, true);
  assert.equal(resAsked.needsSchoolStartConfirmationQuestion, false);
});

test("Grade-specific phrasing policy (1~6학년)", () => {
  assert.ok(getVacationFollowUpQuestion(1).includes("언제 학교 다시 가"));
  assert.ok(getVacationFollowUpQuestion(2).includes("언제 개학해"));
  assert.ok(getVacationFollowUpQuestion(3).includes("개학하는 날짜를 알고 있어"));
  assert.ok(getVacationFollowUpQuestion(4).includes("학교 얘기는 안 물어볼게"));
  assert.ok(getVacationFollowUpQuestion(5).includes("질문은 하지 않을게"));
  assert.ok(getVacationFollowUpQuestion(6).includes("이야기는 묻지 않을게"));

  assert.ok(getSchoolStartConfirmationQuestion(1).includes("오늘 학교 갔어"));
  assert.ok(getSchoolStartConfirmationQuestion(4).includes("이제 학교 갔어"));
});
