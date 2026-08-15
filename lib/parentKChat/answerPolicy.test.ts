import test from "node:test";
import assert from "node:assert/strict";
import {
  answerForDateFact,
  answerForUnavailable,
  buildAskChildContext,
  buildCorrectionRetrievalQuery,
  findPreviousParentInformationQuery,
  isDateFactQuestion,
  latestAskChildContext,
} from "./answerPolicy";
import { resolveParentTemporalQuery } from "./temporalQuery";

const temporal = resolveParentTemporalQuery("어제 뭐 했어?", { now: new Date("2026-08-10T03:00:00Z") });

test("NO_DATA는 EXACT_DATE에서 날짜를 포함하고, SYSTEM_ERROR 문구는 유지된다", () => {
  assert.equal(answerForUnavailable("NO_DATA", temporal), "2026년 8월 9일에 확인되는 기록이 없어요.");
  assert.equal(answerForUnavailable("SYSTEM_ERROR", temporal), "지금은 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
});

test("isDateFactQuestion - true 예시 6개가 전부 true를 반환한다", () => {
  const trueCases = [
    "어제 날짜가 몇 일이야?",
    "어제가 며칠이야?",
    "너 어제 날짜 모르지?",
    "어제 날짜 알아?",
    "오늘 며칠이지?",
    "그날이 언제야?",
  ];
  for (const text of trueCases) {
    assert.equal(isDateFactQuestion(text), true, `Expected true for "${text}"`);
  }
});

test("isDateFactQuestion - false 예시 5개가 전부 false를 반환한다", () => {
  const falseCases = [
    "우리 서아 어제 뭐했어?",
    "어제 날짜 기록이 없어?",
    "8월 9일 서현이는 뭐했어?",
    "평소 뭘 좋아해?",
    "물어봐줘",
  ];
  for (const text of falseCases) {
    assert.equal(isDateFactQuestion(text), false, `Expected false for "${text}"`);
  }
});

test("answerForDateFact는 targetDate가 없으면 null이고, 있으면 자연스러운 날짜 문장을 반환한다", () => {
  const withoutTargetDate = resolveParentTemporalQuery("평소 뭘 좋아해?", { now: new Date("2026-08-10T03:00:00Z") });
  assert.equal(answerForDateFact(withoutTargetDate), null);

  assert.equal(answerForDateFact(temporal), "어제는 2026년 8월 9일이에요.");

  const noLabelTemporal = {
    kind: "EXACT_DATE" as const,
    timeZone: "Asia/Seoul" as const,
    targetDate: "2026-08-15",
    dateRange: null,
    label: null,
    inherited: false,
  };
  assert.equal(answerForDateFact(noLabelTemporal), "그 날은 2026년 8월 15일이에요.");
});

test("ask-child proposal은 직전 unknown detail과 targetDate를 함께 보존한다", () => {
  const result = buildAskChildContext("어떤 장면을 제일 기억해?", temporal, "어떤 장면을 가장 기억하는지");
  assert.equal(result.targetDate, "2026-08-09");
  assert.match(result.proposal, /2026년 8월 9일/);
  assert.match(result.proposal, /어떤 장면/);
});

test("정정은 직전 부모 정보 질문과 현재 정정을 결합한다", () => {
  const previous = findPreviousParentInformationQuery([
    { role: "user", text: "어제 서현이는 뭐 했어?" },
    { role: "k", text: "8월 1일 기록을 잘못 답했어요." },
  ]);
  assert.equal(previous, "어제 서현이는 뭐 했어?");
  assert.match(buildCorrectionRetrievalQuery("아니 어제라고 했잖아", previous!), /부모 정정/);
});

test("plain 물어봐줘는 직전 K의 구조화된 unknown detail을 승계한다", () => {
  const result = latestAskChildContext([
    { role: "k", text: "세부 내용은 없어요.", askChildProposal: "2026년 8월 9일에 가장 기억나는 장면", lastUnknownDetail: "가장 기억나는 장면", targetDate: "2026-08-09" },
  ]);
  assert.equal(result?.lastUnknownDetail, "가장 기억나는 장면");
  assert.equal(result?.targetDate, "2026-08-09");
});
