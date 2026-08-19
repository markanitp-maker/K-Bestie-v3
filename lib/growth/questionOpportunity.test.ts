// 요청서 013 §3-1, §3-2, §3-13, §3-14 — 케이가 언제 물어도 되는지, 무엇을 말하면 안 되는지.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GROWTH_REASK_INTERVAL_DAYS,
  detectGrowthTopicCue,
  resolveGrowthQuestionOpportunity,
} from "./questionOpportunity";

test("013 §3-1: 아이가 키 이야기를 꺼내면 키 화제로 잡는다", () => {
  assert.equal(detectGrowthTopicCue("바지가 다 짧아졌어"), "height");
  assert.equal(detectGrowthTopicCue("나 요즘 엄청 큰 것 같아"), "height");
  assert.equal(detectGrowthTopicCue("오늘 학교에서 신체검사 했어"), "height");
});

test("013 §3-1: 아이가 몸무게를 말하면 몸무게 화제가 우선한다", () => {
  assert.equal(detectGrowthTopicCue("몸무게 재봤어"), "weight");
  // "키" 와 "몸무게" 가 같이 있으면 더 민감한 쪽을 기준으로 잡는다(§3-14).
  assert.equal(detectGrowthTopicCue("키랑 몸무게 다 쟀어"), "weight");
});

test("013 §3-1: 관련 없는 발화에서는 화제가 열리지 않는다", () => {
  for (const utterance of [
    "오늘 급식 맛있었어",
    "민준이랑 축구했어",
    "수학 숙제가 어려웠어",
    "",
  ]) {
    assert.equal(detectGrowthTopicCue(utterance), null, `잘못 열렸다: ${utterance}`);
  }
});

test("013 §3-14: 아이가 거부 신호를 보이면 화제를 열지 않는다", () => {
  for (const utterance of [
    "키 말하기 싫어",
    "몸무게는 비밀이야",
    "그런 거 왜 물어봐",
    "키 얘기 부끄러워",
  ]) {
    assert.equal(detectGrowthTopicCue(utterance), null, `거부인데 열렸다: ${utterance}`);
  }
});

test("013 §3-2: 성장정보를 설정하지 않은 아이에게는 묻지 않는다", async () => {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  } as never;
  const result = await resolveGrowthQuestionOpportunity({
    db,
    childId: "child-1",
    utterance: "바지가 다 짧아졌어",
  });
  assert.equal(result.measurementType, null);
  assert.equal(result.instruction, undefined);
});

test("013 §3-2: 화제 신호가 없으면 DB 를 조회하지 않는다", async () => {
  let queried = false;
  const db = {
    from: () => {
      queried = true;
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  } as never;
  await resolveGrowthQuestionOpportunity({ db, childId: "child-1", utterance: "오늘 급식 맛있었어" });
  assert.equal(queried, false, "신호 없는 턴에서 DB 를 조회했다");
});

test("013 §3-2: 조회가 실패하면 묻지 않는 쪽으로 닫는다", async () => {
  const db = {
    from: () => {
      throw new Error("db down");
    },
  } as never;
  const result = await resolveGrowthQuestionOpportunity({
    db,
    childId: "child-1",
    utterance: "바지가 다 짧아졌어",
  });
  assert.equal(result.measurementType, null);
});

test("013 §3-2: 재질문 간격이 정의돼 있다", () => {
  assert.ok(GROWTH_REASK_INTERVAL_DAYS >= 7, "재질문 간격이 너무 짧다");
});

test("013 §3-13, §3-14: 질문 지침이 아이에게 평가·비교를 시키지 않는다", async () => {
  const db = {
    from: (table: string) => {
      if (table === "child_growth_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { child_id: "c" } }) }) }) };
      }
      // 최근 값 없음 — 문이 열린다.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }),
            not: () => ({ gte: () => ({ limit: async () => ({ data: [] }) }) }),
          }),
        }),
      };
    },
  } as never;

  for (const [utterance, expected] of [
    ["바지가 다 짧아졌어", "height"],
    ["몸무게 얘기 나왔어", "weight"],
  ] as const) {
    const result = await resolveGrowthQuestionOpportunity({ db, childId: "c", utterance });
    assert.equal(result.measurementType, expected);
    const instruction = result.instruction ?? "";
    assert.ok(instruction.length > 0, "지침이 비었다");
    // §3-13 금지 표현이 지침에 들어가 있으면 케이가 그대로 따라 할 수 있다.
    for (const forbidden of ["평균", "정상", "과체중", "저체중", "백분위", "BMI"]) {
      assert.ok(!instruction.includes(forbidden), `금지 개념이 지침에 있다: ${forbidden}`);
    }
    // 대신 "평가/비교하지 마라" 는 반드시 있어야 한다.
    assert.ok(/평가|비교/.test(instruction), "평가·비교 금지 지침이 없다");
  }
});
