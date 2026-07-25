import { test } from "node:test";
import assert from "node:assert/strict";

import { selectMbtiQuestions } from "./selectQuestions";
import { QUESTION_BANK, assertQuestionBankShape } from "../data/questionBank";
import type { Axis } from "../data/mbtiTypes";

const QUESTION_BY_ID = new Map(QUESTION_BANK.map((q) => [q.id, q]));

/** 시드 기반 결정론적 의사난수(테스트 재현성용) — Math.random 대신 주입한다. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test("문항뱅크 불변조건: 200문항, 축당 50, 축당 A극 25/25 균형", () => {
  assertQuestionBankShape(QUESTION_BANK);
});

test("selectMbtiQuestions: 정확히 20문항, 중복 없음, 축당 5문항", () => {
  const selection = selectMbtiQuestions({ recentSessionsQuestionIds: [], random: seededRandom(1) });
  assert.equal(selection.questionOrder.length, 20);
  assert.equal(new Set(selection.questionOrder).size, 20);

  const countByAxis = new Map<Axis, number>();
  for (const id of selection.questionOrder) {
    const q = QUESTION_BY_ID.get(id);
    assert.ok(q, `선정된 id가 문항뱅크에 존재해야 함: ${id}`);
    countByAxis.set(q!.axis, (countByAxis.get(q!.axis) ?? 0) + 1);
  }
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    assert.equal(countByAxis.get(axis), 5, `${axis} 축은 5문항이어야 함`);
  }
});

test("selectMbtiQuestions: 같은 축이 연속 배치되지 않음", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const selection = selectMbtiQuestions({ recentSessionsQuestionIds: [], random: seededRandom(seed) });
    for (let i = 1; i < selection.questionOrder.length; i++) {
      const prevAxis = QUESTION_BY_ID.get(selection.questionOrder[i - 1]!)!.axis;
      const currAxis = QUESTION_BY_ID.get(selection.questionOrder[i]!)!.axis;
      assert.notEqual(prevAxis, currAxis, `seed=${seed} index=${i}에서 같은 축(${currAxis})이 연속됨`);
    }
  }
});

test("selectMbtiQuestions: optionOrder가 20개 문항 전부에 대해 AB|BA로 존재", () => {
  const selection = selectMbtiQuestions({ recentSessionsQuestionIds: [], random: seededRandom(7) });
  for (const id of selection.questionOrder) {
    const order = selection.optionOrder[id];
    assert.ok(order === "AB" || order === "BA", `optionOrder[${id}]가 유효하지 않음: ${order}`);
  }
  assert.equal(Object.keys(selection.optionOrder).length, 20);
});

test("selectMbtiQuestions: 최근 세션에서 나온 문항은 신선한 후보가 충분하면 회피됨", () => {
  // 각 축에서 최근 세션 1회에 5문항이 나온 것으로 시뮬레이션(그 세션의 questionOrder는
  // 실제로는 축이 섞여 있지만, 회피 로직은 문항 ID 집합만 보므로 축별로 나눠 구성해도 무방).
  const recentSessionIds: string[] = [];
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    const ids = QUESTION_BANK.filter((q) => q.axis === axis)
      .slice(0, 5)
      .map((q) => q.id);
    recentSessionIds.push(...ids);
  }

  const selection = selectMbtiQuestions({
    recentSessionsQuestionIds: [recentSessionIds],
    random: seededRandom(3),
  });

  const overlap = selection.questionOrder.filter((id) => recentSessionIds.includes(id));
  // 축당 50문항 중 5문항만 최근 사용됐으므로(45개 신선한 후보 존재) 완전히 회피 가능해야 한다.
  assert.equal(overlap.length, 0, `최근 사용 문항이 재출제됨: ${overlap.join(", ")}`);
});

test("selectMbtiQuestions: 후보가 부족하면(전 문항 최근 사용) 가장 오래된 세션부터 다시 허용해 5문항을 채움", () => {
  // 극단 케이스: 3개 최근 세션이 축당 50문항 전부를 나눠 "사용"한 것으로 시뮬레이션하면
  // 신선한 후보가 0개가 되지만, 그래도 각 축 5문항은 반드시 채워져야 한다(가장 오래된
  // 세션 = 배열의 마지막 인덱스부터 재허용).
  const perAxisIds = new Map<Axis, string[]>();
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    perAxisIds.set(axis, QUESTION_BANK.filter((q) => q.axis === axis).map((q) => q.id));
  }
  // 축당 50문항을 3세션에 17/17/16으로 나눠 "전량 최근 사용됨" 상태를 만든다.
  const sessions: string[][] = [[], [], []];
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    const ids = perAxisIds.get(axis)!;
    ids.forEach((id, i) => sessions[i % 3]!.push(id));
  }

  const selection = selectMbtiQuestions({
    recentSessionsQuestionIds: sessions,
    random: seededRandom(9),
  });

  assert.equal(selection.questionOrder.length, 20, "후보 부족 상황에서도 20문항을 반드시 채워야 함");
});
