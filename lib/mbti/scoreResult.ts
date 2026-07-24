/**
 * 케이 놀이: MBTI — 판정 로직 (SPEC.md §3.1)
 *
 * 16문항 답변 배열을 입력받아 4축(EI/SN/TF/JP)별 우세극을 계산하고,
 * 4글자 MBTI 유형 문자열을 반환하는 순수 함수. AI/네트워크 호출 없음.
 *
 * 동점(2:2) 시 `TIE_BREAK_POLE`(mbtiTypes.ts)의 기본극을 채택한다.
 */

import { QUESTION_BANK } from "../data/questionBank";
import {
  ALL_MBTI_TYPES,
  AXIS_POLES,
  TIE_BREAK_POLE,
  type Axis,
  type MbtiType,
  type Pole,
} from "../data/mbtiTypes";

/** 한 문항에 대한 답변. 문항 ID와 선택한 극을 참조한다. */
export interface MbtiAnswer {
  /** `QUESTION_BANK`의 `Question.id`와 일치해야 한다(예: "EI-1"). */
  questionId: string;
  /** 선택한 선택지가 배점되는 극. 해당 문항의 축에 속한 극이어야 한다. */
  selectedPole: Pole;
}

const QUESTION_BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));

/** 축별 두 극의 득표수를 세는 카운터. */
function createAxisTally(axis: Axis): Map<Pole, number> {
  const [poleA, poleB] = AXIS_POLES[axis];
  return new Map<Pole, number>([
    [poleA, 0],
    [poleB, 0],
  ]);
}

/** 축의 득표수를 비교해 우세극을 결정한다. 동점이면 기본극(TIE_BREAK_POLE)을 채택한다. */
function resolveAxisWinner(axis: Axis, tally: Map<Pole, number>): Pole {
  const [poleA, poleB] = AXIS_POLES[axis];
  const countA = tally.get(poleA) ?? 0;
  const countB = tally.get(poleB) ?? 0;

  if (countA === countB) {
    return TIE_BREAK_POLE[axis];
  }
  return countA > countB ? poleA : poleB;
}

/**
 * 16문항 답변 배열을 채점해 4글자 MBTI 유형을 반환한다.
 *
 * 잘못된 입력(문항 수 불일치, 존재하지 않는 문항 ID, 문항 중복,
 * 해당 문항 축에 속하지 않는 극)은 조용히 무시하지 않고 즉시 예외를 던진다.
 */
export function scoreMbtiAnswers(answers: readonly MbtiAnswer[]): MbtiType {
  if (answers.length !== QUESTION_BANK.length) {
    throw new Error(
      `답변은 정확히 ${QUESTION_BANK.length}개여야 합니다. 현재: ${answers.length}개`,
    );
  }

  const tallyByAxis: Record<Axis, Map<Pole, number>> = {
    EI: createAxisTally("EI"),
    SN: createAxisTally("SN"),
    TF: createAxisTally("TF"),
    JP: createAxisTally("JP"),
  };

  const answeredQuestionIds = new Set<string>();

  for (const answer of answers) {
    const question = QUESTION_BY_ID.get(answer.questionId);
    if (!question) {
      throw new Error(`알 수 없는 문항 ID: "${answer.questionId}"`);
    }
    if (answeredQuestionIds.has(answer.questionId)) {
      throw new Error(`문항 "${answer.questionId}"에 대한 답변이 중복되었습니다.`);
    }
    answeredQuestionIds.add(answer.questionId);

    const axisPoles = AXIS_POLES[question.axis];
    if (!axisPoles.includes(answer.selectedPole)) {
      throw new Error(
        `문항 "${answer.questionId}"(${question.axis} 축)에 유효하지 않은 극입니다: ` +
          `"${answer.selectedPole}" (허용된 극: ${axisPoles.join(", ")})`,
      );
    }

    const tally = tallyByAxis[question.axis];
    tally.set(answer.selectedPole, (tally.get(answer.selectedPole) ?? 0) + 1);
  }

  const ei = resolveAxisWinner("EI", tallyByAxis.EI);
  const sn = resolveAxisWinner("SN", tallyByAxis.SN);
  const tf = resolveAxisWinner("TF", tallyByAxis.TF);
  const jp = resolveAxisWinner("JP", tallyByAxis.JP);

  const result = `${ei}${sn}${tf}${jp}`;
  if (!ALL_MBTI_TYPES.includes(result as MbtiType)) {
    throw new Error(`계산된 결과가 유효한 MBTI 유형이 아닙니다: "${result}"`);
  }

  return result as MbtiType;
}
