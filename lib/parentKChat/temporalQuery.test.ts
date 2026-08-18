import test from "node:test";
import assert from "node:assert/strict";
import {
  parentSourcePriority,
  resolveParentTemporalQuery,
  resolveTemporalFromUserContext,
  temporalMatchForEvidence,
} from "./temporalQuery";

const NOW = new Date("2026-08-10T03:00:00.000Z"); // 2026-08-10 12:00 KST

test("KST exact date 표현을 결정적으로 해석한다", () => {
  assert.equal(resolveParentTemporalQuery("오늘 뭐 했어?", { now: NOW }).targetDate, "2026-08-10");
  assert.equal(resolveParentTemporalQuery("어제 뭐 했어?", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("그제 뭐 했어?", { now: NOW }).targetDate, "2026-08-08");
  assert.equal(resolveParentTemporalQuery("내일 일정은?", { now: NOW }).targetDate, "2026-08-11");
  assert.equal(resolveParentTemporalQuery("8월 9일에 뭐 했어?", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("2026년 8월 9일에 뭐 했어?", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("2026-08-09 기록", { now: NOW }).targetDate, "2026-08-09");
});

test("주·월·최근·장기 범위를 구분한다", () => {
  assert.deepEqual(resolveParentTemporalQuery("이번 주 어땠어?", { now: NOW }).dateRange, { from: "2026-08-10", to: "2026-08-16" });
  assert.deepEqual(resolveParentTemporalQuery("지난주 어땠어?", { now: NOW }).dateRange, { from: "2026-08-03", to: "2026-08-09" });
  assert.deepEqual(resolveParentTemporalQuery("이번 달 어땠어?", { now: NOW }).dateRange, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(resolveParentTemporalQuery("요즘 뭘 좋아해?", { now: NOW }).kind, "RECENT");
  assert.equal(resolveParentTemporalQuery("평소 뭘 좋아해?", { now: NOW }).kind, "LONG_TERM");
});

test("후속 질문은 직전 부모 질문의 날짜만 승계하고 K 답변은 날짜 근거로 쓰지 않는다", () => {
  const result = resolveTemporalFromUserContext("그날 어떤 걸 제일 기억해?", [
    { role: "user", text: "어제 뭐 했어?" },
    { role: "k", text: "8월 1일에 놀이터에 갔어요." },
  ], NOW);
  assert.equal(result.kind, "EXACT_DATE");
  assert.equal(result.targetDate, "2026-08-09");
  assert.equal(result.inherited, true);
});

test("exact-date에서 다른 날짜 evidence는 primary 불가다", () => {
  const temporal = resolveParentTemporalQuery("8월 9일 뭐 했어?", { now: NOW });
  assert.equal(temporalMatchForEvidence("2026-08-09", temporal), "EXACT");
  assert.equal(temporalMatchForEvidence("2026-08-01", temporal), "MISMATCH");
});

test("source 우선순위는 temporal kind에 따라 semantic score보다 앞선다", () => {
  assert.ok(parentSourcePriority("EXACT_DATE", "daily_report") < parentSourcePriority("EXACT_DATE", "memory_fact"));
  assert.ok(parentSourcePriority("DATE_RANGE", "weekly_report") < parentSourcePriority("DATE_RANGE", "daily_report"));
  assert.ok(parentSourcePriority("LONG_TERM", "memory_fact") < parentSourcePriority("LONG_TERM", "daily_report"));
});

test("부정 구분자(말고/아니라/아니고/대신/이 아니라)를 통한 날짜 정정 테스트 4종", () => {
  // 1. '아니, 어제 말고 오늘' + 직전 맥락이 어제 → 오늘 로 해석
  const context = [
    { role: "user" as const, text: "서현이 어제 뭐 했어?" },
    { role: "k" as const, text: "2026년 8월 09일에 확인되는 기록이 없어요." },
  ];
  const correctionResult = resolveTemporalFromUserContext("아니, 어제 말고 오늘", context, NOW);
  assert.equal(correctionResult.targetDate, "2026-08-10");
  assert.equal(correctionResult.kind, "EXACT_DATE");

  // 2. '오늘 말고 어제' → 어제
  assert.equal(resolveParentTemporalQuery("오늘 말고 어제", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("오늘 아니라 어제", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("오늘 아니고 어제", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("오늘 대신 어제", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("오늘 이 아니라 어제", { now: NOW }).targetDate, "2026-08-09");
  assert.equal(resolveParentTemporalQuery("주간 말고 오늘 하루", { now: NOW }).targetDate, "2026-08-10");

  // 3. '어제 뭐 했어?'(구분자 없음) → 어제 (기존 동작 회귀 방어)
  assert.equal(resolveParentTemporalQuery("어제 뭐 했어?", { now: NOW }).targetDate, "2026-08-09");

  // 4. '말고' 만 있는 입력 → 예외 없이 기존 동작
  assert.doesNotThrow(() => {
    const result = resolveParentTemporalQuery("말고", { now: NOW });
    assert.equal(result.kind, "NONE");
  });
});

