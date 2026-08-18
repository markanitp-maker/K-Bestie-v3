import test from "node:test";
import assert from "node:assert/strict";
import {
  answerForDateFact,
  answerForUnavailable,
  applyRepeatAvoidancePrefix,
  buildAskChildContext,
  buildCorrectionRetrievalQuery,
  buildGeneralChatContents,
  findPreviousParentInformationQuery,
  formatConversationContextForPrompt,
  answerForClockFact,
  isClockFactQuestion,
  isDateFactQuestion,
  latestAskChildContext,
  REPEAT_ANSWER_PREFIXES,
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

test("직전 케이 응답 반복 방지 접두 문구 테스트 3종", () => {
  const baseAnswer = "누적 기억에 따르면, 아이는 가족과 함께 식사하는 시간을 가장 좋아한다고 해요.";

  // 5. 직전 케이 응답과 같은 문장 → 접두 문구가 붙는다 (공백/문장부호 차이 허용)
  const previousK = "누적기억에 따르면 아이는 가족과 함께 식사하는 시간을 가장 좋아한다고 해요!";
  const contextWithSameResponse = [
    { role: "user" as const, text: "최근에는 뭐했니?" },
    { role: "k" as const, text: previousK },
    { role: "user" as const, text: "그게 전부니?" },
  ];
  const modifiedAnswer = applyRepeatAvoidancePrefix(baseAnswer, contextWithSameResponse);
  const matchedPrefix = REPEAT_ANSWER_PREFIXES.find((p) => modifiedAnswer.startsWith(p));
  assert.ok(matchedPrefix, `Expected answer to start with one of REPEAT_ANSWER_PREFIXES, got: ${modifiedAnswer}`);
  assert.ok(modifiedAnswer.includes(baseAnswer));

  // 6. 다른 문장 → 그대로 나간다 (정상 응답을 건드리면 안 된다)
  const previousKDifferent = "어제는 친구와 함께 놀이터에서 신나게 뛰어놀았어요.";
  const contextWithDifferentResponse = [
    { role: "user" as const, text: "어제 뭐 했어?" },
    { role: "k" as const, text: previousKDifferent },
    { role: "user" as const, text: "오늘 뭐 했어?" },
  ];
  const untouchedAnswer = applyRepeatAvoidancePrefix(baseAnswer, contextWithDifferentResponse);
  assert.equal(untouchedAnswer, baseAnswer);

  // 7. 접두 문구가 연속으로 같은 것만 나오지 않는다
  const firstPrefix = REPEAT_ANSWER_PREFIXES[0];
  const contextAfterFirstRepetition = [
    { role: "user" as const, text: "최근에는 뭐했니?" },
    { role: "k" as const, text: `${firstPrefix}${baseAnswer}` },
    { role: "user" as const, text: "그게 전부니?" },
  ];
  const secondAnswer = applyRepeatAvoidancePrefix(baseAnswer, contextAfterFirstRepetition);
  assert.ok(!secondAnswer.startsWith(firstPrefix), `Expected second answer to avoid ${firstPrefix}, got ${secondAnswer}`);
  assert.ok(REPEAT_ANSWER_PREFIXES.some((p) => p !== firstPrefix && secondAnswer.startsWith(p)));
});

test("근거 경로 대화 맥락: 케이 턴 포함 및 순서 유지, 빈 맥락 처리", () => {
  // 1. 근거 경로의 대화 맥락 문자열에 케이 턴이 포함된다
  // 2. 순서가 유지된다
  const context = [
    { role: "user" as const, text: "최근에는 뭐했니?" },
    { role: "k" as const, text: "최근 리포트에 따르면 축구를 했어요." },
    { role: "user" as const, text: "그게 전부니?" },
  ];
  const formatted = formatConversationContextForPrompt(context);
  assert.equal(
    formatted,
    "부모: 최근에는 뭐했니?\n케이: 최근 리포트에 따르면 축구를 했어요.\n부모: 그게 전부니?",
  );
  assert.match(formatted, /^부모: 최근에는 뭐했니\?\n케이:/);

  // 3. 맥락이 비면 예전처럼 빈 문자열이다
  assert.equal(formatConversationContextForPrompt([]), "");
});

test("일반 대화 SDK contents: user/model 턴 변환 및 순서 유지, 현재 질문 추가", () => {
  const context = [
    { role: "user" as const, text: "안녕 케이야" },
    { role: "k" as const, text: "안녕하세요! 오늘 어떤 하루를 보내셨나요?" },
  ];
  const currentQuestion = "너 오늘 기분 어때?";
  const contents = buildGeneralChatContents(context, currentQuestion);

  assert.deepEqual(contents, [
    { role: "user", parts: [{ text: "안녕 케이야" }] },
    { role: "model", parts: [{ text: "안녕하세요! 오늘 어떤 하루를 보내셨나요?" }] },
    { role: "user", parts: [{ text: "너 오늘 기분 어때?" }] },
  ]);

  // 빈 맥락일 때는 현재 질문 1개만 user 턴으로 담긴다
  const emptyContents = buildGeneralChatContents([], "안녕하세요");
  assert.deepEqual(emptyContents, [{ role: "user", parts: [{ text: "안녕하세요" }] }]);
});


