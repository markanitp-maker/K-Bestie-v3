import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreMbtiAnswers, type MbtiAnswer } from "./scoreResult";
import { QUESTION_BANK } from "../data/questionBank";
import { AXIS_POLES, type Axis, type Pole } from "../data/mbtiTypes";

function firstNQuestionsForAxis(axis: Axis, n: number) {
  return QUESTION_BANK.filter((q) => q.axis === axis).slice(0, n);
}

/** 문항에서 지정한 극에 해당하는 선택지의 id("A"|"B")를 찾는다(문항마다 A/B ↔ 극 매핑이 다름). */
function optionIdForPole(question: (typeof QUESTION_BANK)[number], pole: Pole): "A" | "B" {
  const choice = question.choices.find((c) => c.pole === pole);
  assert.ok(choice, `문항 "${question.id}"에 극 "${pole}"에 해당하는 선택지가 없음`);
  return choice!.id;
}

/** 각 축 5문항씩, 지정한 극이 다수결로 이기도록(3:2) 답변을 구성한다. 문항마다 A/B가 어느
 * 극을 가리키는지 다르므로, 항상 실제 극을 기준으로 선택지 id를 조회해서 답한다. */
function buildAnswers(winners: Record<Axis, Pole>): readonly MbtiAnswer[] {
  const answers: MbtiAnswer[] = [];
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    const questions = firstNQuestionsForAxis(axis, 5);
    assert.equal(questions.length, 5, `${axis} 축에 5문항 이상 있어야 테스트 가능(현재 문항뱅크 확인 필요)`);
    const [poleA, poleB] = AXIS_POLES[axis];
    const loser = winners[axis] === poleA ? poleB : poleA;
    questions.forEach((q, i) => {
      const pole = i < 3 ? winners[axis] : loser;
      answers.push({ questionId: q.id, selectedOptionId: optionIdForPole(q, pole) });
    });
  }
  return answers;
}

const ALL_A_WINNERS: Record<Axis, Pole> = { EI: "E", SN: "S", TF: "F", JP: "J" };

test("scoreMbtiAnswers: 20문항(축당 5) 정상 채점 시 4글자 유형과 축별 득표 반환", () => {
  const answers = buildAnswers(ALL_A_WINNERS);
  const result = scoreMbtiAnswers(answers);
  assert.equal(result.mbtiType.length, 4);
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    const axisResult = result.axisResults[axis];
    assert.equal(axisResult.countA + axisResult.countB, 5);
    assert.equal(axisResult.winner, ALL_A_WINNERS[axis]);
    const winnerCount = axisResult.winner === axisResult.poleA ? axisResult.countA : axisResult.countB;
    assert.equal(winnerCount, 3);
  }
});

test("scoreMbtiAnswers: 답변이 20개가 아니면 예외", () => {
  const answers = buildAnswers(ALL_A_WINNERS).slice(0, 19);
  assert.throws(() => scoreMbtiAnswers(answers));
});

test("scoreMbtiAnswers: 존재하지 않는 문항 ID면 예외", () => {
  const answers = buildAnswers(ALL_A_WINNERS).slice(0, 19);
  answers.push({ questionId: "ZZ-99", selectedOptionId: "A" });
  assert.throws(() => scoreMbtiAnswers(answers));
});

test("scoreMbtiAnswers: 같은 문항 중복 답변이면 예외", () => {
  const answers = [...buildAnswers(ALL_A_WINNERS)];
  const duplicated = [...answers.slice(0, 19), answers[0]!];
  assert.throws(() => scoreMbtiAnswers(duplicated));
});

test("scoreMbtiAnswers: 해당 문항에 없는 옵션 id면 예외", () => {
  // 20문항을 모두 채운 뒤 그중 한 답변의 selectedOptionId를 문항에 없는 값("C")으로 바꿔
  // 순수하게 "유효하지 않은 옵션 id" 사유로만 예외가 나는지 확인한다(문항 수/중복은 정상).
  const answers = buildAnswers(ALL_A_WINNERS).map((a) => ({ ...a }));
  (answers[0] as { selectedOptionId: string }).selectedOptionId = "C";
  assert.throws(() => scoreMbtiAnswers(answers));
});
