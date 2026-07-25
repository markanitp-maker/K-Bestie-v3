/**
 * 케이 놀이: MBTI — 판정 로직 (2026-07-25 200문항뱅크/축당 5문항 다수결 개편)
 *
 * 20문항 답변 배열(축당 5문항)을 입력받아 4축(EI/SN/TF/JP)별 우세극을 단순 다수결로
 * 계산하고, 4글자 MBTI 유형 문자열을 반환하는 순수 함수. AI/네트워크 호출 없음.
 *
 * 축당 5문항(홀수)이므로 2.5:2.5 동점이 구조적으로 불가능하다 — 기존 16문항/축당
 * 4문항 체계에 있던 동점 기본극(TIE_BREAK_POLE) 처리는 더 이상 필요 없어 제거했다.
 */

import { QUESTION_BANK } from "../data/questionBank";
import { ALL_MBTI_TYPES, AXIS_POLES, type Axis, type MbtiType, type Pole } from "../data/mbtiTypes";

/** 한 문항에 대한 답변. 문항 ID와 선택한 옵션(뱅크 원본 id, 화면 좌우 위치 아님)을 참조한다. */
export interface MbtiAnswer {
  /** `QUESTION_BANK`의 `Question.id`와 일치해야 한다(예: "EI-05"). */
  questionId: string;
  /** 선택한 문항뱅크 원본 옵션 id("A" | "B"). 화면에 실제 표시된 좌우 위치(optionOrder)와
   * 무관하게, 항상 문항뱅크가 정의한 원본 id를 저장한다 — 채점은 이 id로 극을 조회한다. */
  selectedOptionId: "A" | "B";
}

export interface MbtiAxisResult {
  poleA: Pole;
  poleB: Pole;
  countA: number;
  countB: number;
  /** 다수결로 확정된 우세극(5문항 다수결이라 동점 불가능). */
  winner: Pole;
}

export interface MbtiScoreResult {
  mbtiType: MbtiType;
  axisResults: Readonly<Record<Axis, MbtiAxisResult>>;
}

const QUESTION_BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));
const QUESTIONS_PER_AXIS = 5;
const TOTAL_QUESTIONS = 20;

/**
 * 20문항 답변 배열을 채점해 4글자 MBTI 유형과 축별 득표 상세를 반환한다.
 *
 * 잘못된 입력(문항 수 불일치, 존재하지 않는 문항 ID, 문항 중복, 해당 문항에 없는
 * 옵션 id, 축당 5문항이 아닌 경우)은 조용히 무시하지 않고 즉시 예외를 던진다.
 */
export function scoreMbtiAnswers(answers: readonly MbtiAnswer[]): MbtiScoreResult {
  if (answers.length !== TOTAL_QUESTIONS) {
    throw new Error(`답변은 정확히 ${TOTAL_QUESTIONS}개여야 합니다. 현재: ${answers.length}개`);
  }

  const tallyByAxis: Record<Axis, Map<Pole, number>> = {
    EI: new Map(AXIS_POLES.EI.map((pole) => [pole, 0])),
    SN: new Map(AXIS_POLES.SN.map((pole) => [pole, 0])),
    TF: new Map(AXIS_POLES.TF.map((pole) => [pole, 0])),
    JP: new Map(AXIS_POLES.JP.map((pole) => [pole, 0])),
  };
  const answeredCountByAxis: Record<Axis, number> = { EI: 0, SN: 0, TF: 0, JP: 0 };

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

    const selectedChoice = question.choices.find((choice) => choice.id === answer.selectedOptionId);
    if (!selectedChoice) {
      throw new Error(
        `문항 "${answer.questionId}"에 유효하지 않은 옵션 id입니다: "${answer.selectedOptionId}"`,
      );
    }

    const tally = tallyByAxis[question.axis];
    tally.set(selectedChoice.pole, (tally.get(selectedChoice.pole) ?? 0) + 1);
    answeredCountByAxis[question.axis] += 1;
  }

  const axisResults = {} as Record<Axis, MbtiAxisResult>;
  for (const axis of ["EI", "SN", "TF", "JP"] as const) {
    if (answeredCountByAxis[axis] !== QUESTIONS_PER_AXIS) {
      throw new Error(
        `${axis} 축은 정확히 ${QUESTIONS_PER_AXIS}문항이어야 합니다. 현재: ${answeredCountByAxis[axis]}문항`,
      );
    }

    const [poleA, poleB] = AXIS_POLES[axis];
    const countA = tallyByAxis[axis].get(poleA) ?? 0;
    const countB = tallyByAxis[axis].get(poleB) ?? 0;

    if (countA === countB) {
      // 축당 5문항(홀수) 체계에서는 수학적으로 도달 불가능한 상태다. 조용히 임의 극을
      // 채택하는 대신, 상위 호출부(설계상 절대 발생하면 안 되는 방어선)에 즉시 알린다.
      throw new Error(
        `${axis} 축 동점(${countA}:${countB})은 축당 ${QUESTIONS_PER_AXIS}문항 체계에서 발생할 수 없는 상태입니다.`,
      );
    }

    axisResults[axis] = {
      poleA,
      poleB,
      countA,
      countB,
      winner: countA > countB ? poleA : poleB,
    };
  }

  const mbtiType = `${axisResults.EI.winner}${axisResults.SN.winner}${axisResults.TF.winner}${axisResults.JP.winner}`;
  if (!ALL_MBTI_TYPES.includes(mbtiType as MbtiType)) {
    throw new Error(`계산된 결과가 유효한 MBTI 유형이 아닙니다: "${mbtiType}"`);
  }

  return { mbtiType: mbtiType as MbtiType, axisResults };
}
