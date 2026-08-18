import test from "node:test";
import assert from "node:assert/strict";
import {
  answerForDateFact,
  answerForUnavailable,
  buildAskChildContext,
  buildCorrectionRetrievalQuery,
  findPreviousParentInformationQuery,
  answerForClockFact,
  isClockFactQuestion,
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

test("요일·시간·월은 KST 계산값으로 답한다(모델 추측 금지)", () => {
  // 2026-08-16 Dev 실측: 일요일인데 LLM이 "수요일"로 답했다. 084 §9 위반.
  const now = new Date("2026-08-16T02:30:00Z"); // KST 2026-08-16(일) 11:30
  assert.equal(answerForClockFact("오늘 무슨 요일이야?", now), "오늘은 일요일이에요.");
  assert.match(String(answerForClockFact("지금 몇 시야?", now)), /^지금은 오전 11:30/);
  assert.equal(answerForClockFact("이번 달이 몇 월이야?", now), "이번 달은 8월이에요.");
});

test("아이에 대한 질문은 요일·시간 답변으로 새지 않는다", () => {
  for (const q of [
    "우리 아이가 오늘 뭐 했어?",
    "서현이 오늘 무슨 요일에 학원 가?",
    "어제 우리 애 기분 어땠어?",
  ]) {
    assert.equal(isClockFactQuestion(q), false, q);
    assert.equal(answerForClockFact(q), null, q);
  }
});

test("날짜(며칠) 질문은 기존 경로가 계속 담당한다", () => {
  assert.equal(isClockFactQuestion("어제 날짜가 몇 일이야?"), false);
  assert.equal(isDateFactQuestion("어제 날짜가 몇 일이야?"), true);
});

test("정정 복구는 직전 발화가 아이 정보 질문일 때만 한다 — 케이 자신에 대한 질문을 되돌리면 안 된다", () => {
  // 2026-08-18 Dev QA 실측 사고:
  //   부모  너 업데이트 되니?        → 케이가 자기 얘기로 정상 응답
  //   부모  뭔 소리야? 대화가 안 된다? → FEEDBACK 으로 분류되는 건 맞았는데,
  //         직전 발화("너 업데이트 되니?")를 아이 정보 질문으로 착각해 기록을 재조회했다.
  //         결과: "2026년 8월 18일에 확인되는 기록이 없어요" + 엉뚱한 질문 초안.
  const context = [
    { role: "user" as const, text: "너 대화 저장 안되니?" },
    { role: "k" as const, text: "저는 대화 내용이 따로 저장되지 않아요." },
    { role: "user" as const, text: "너 업데이트 되니?" },
    { role: "k" as const, text: "네, 계속 좋아지고 있어요." },
  ];

  // 판별자를 넘기면 아이 정보 질문이 하나도 없으므로 복구 대상이 없다.
  const isChildInfo = (text: string) => /서현|서아|아이|오늘\s*뭐/.test(text);
  assert.equal(findPreviousParentInformationQuery(context, isChildInfo), null);

  // 판별자를 안 넘기면 예전처럼 아무거나 집어온다 — 그게 사고의 원인이었다.
  assert.equal(findPreviousParentInformationQuery(context), "너 업데이트 되니?");

  // 아이 정보 질문이 실제로 있으면 그것을 복구한다(정상 기능 회귀 방어).
  const withChildQuery = [
    { role: "user" as const, text: "서현이 오늘 뭐 했어?" },
    { role: "k" as const, text: "기록이 없어요." },
    { role: "user" as const, text: "너 업데이트 되니?" },
    { role: "k" as const, text: "네, 계속 좋아지고 있어요." },
  ];
  assert.equal(findPreviousParentInformationQuery(withChildQuery, isChildInfo), "서현이 오늘 뭐 했어?");
});
