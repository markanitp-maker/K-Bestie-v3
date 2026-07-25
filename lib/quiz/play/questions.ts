import type { QuizQuestionBankRow } from "./types";

// 퀴즈마스터 프로젝트에서 포팅 — 순수 함수, DB 미접촉.
// correct_option_index는 이 파일이 반환하는 어떤 형태에도 절대 포함되지 않는다.

export interface PublicQuestion {
  id: string;
  question_text: string;
  /** 표시 순서로 정렬된 옵션: options[slot]이 그 슬롯에 보이는 텍스트. */
  options: string[];
}

/** Fisher–Yates로 옵션 4개의 표시 순열을 만든다. order[slot] = 원본 옵션 인덱스. */
export function generateOptionOrder(rng: () => number = Math.random): number[] {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

export function buildDisplayQuestion(
  row: Pick<QuizQuestionBankRow, "id" | "question_text" | "options">,
  order: number[]
): PublicQuestion {
  return {
    id: row.id,
    question_text: row.question_text,
    options: order.map((originalIndex) => row.options[originalIndex]),
  };
}
