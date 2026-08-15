import test from "node:test";
import assert from "node:assert/strict";
import {
  answerForUnavailable,
  buildAskChildContext,
  buildCorrectionRetrievalQuery,
  findPreviousParentInformationQuery,
  latestAskChildContext,
} from "./answerPolicy";
import { resolveParentTemporalQuery } from "./temporalQuery";

const temporal = resolveParentTemporalQuery("어제 뭐 했어?", { now: new Date("2026-08-10T03:00:00Z") });

test("NO_DATA와 SYSTEM_ERROR를 사용자 문구에서 구분한다", () => {
  assert.equal(answerForUnavailable("NO_DATA", temporal), "그 날짜에 확인되는 기록이 없어요.");
  assert.match(answerForUnavailable("SYSTEM_ERROR", temporal), /불러오지 못했/);
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
