/**
 * 케이 놀이: MBTI — 세션별 20문항 선정 알고리즘 (2026-07-25 200문항뱅크 개편)
 *
 * 축(EI/SN/TF/JP)별 정확히 5문항씩 총 20문항을 뽑고, 같은 축이 연속되지 않도록
 * 전체 순서를 섞은 뒤, 문항별 화면 좌우(A/B) 노출 순서를 함께 고정한다. 이 함수의
 * 반환값은 세션 생성 시 단 한 번 계산되어 `progress_state.mbti`에 그대로 저장되고,
 * 이후 새로고침·화면 이탈·이어하기에서도 절대 다시 계산하지 않는다(호출부 책임).
 *
 * 최근 재출제 회피: 같은 아이의 최근 완료 세션 최대 3회(최신순)에서 나온 문항 ID를
 * `recentSessionsQuestionIds[0..2]`로 전달하면, 그 문항들은 1순위로 후보에서 제외된다.
 * 축당 후보가 5개 미만으로 부족해지면(문항뱅크가 아주 작을 때만 이론상 발생) 가장
 * 오래전(인덱스가 큰 세션)에 나온 문항부터 순서대로 다시 허용한다.
 */

import { QUESTION_BANK, type Question } from "../data/questionBank";
import type { Axis } from "../data/mbtiTypes";

const AXES: readonly Axis[] = ["EI", "SN", "TF", "JP"];
const QUESTIONS_PER_AXIS = 5;

/** 문항 화면 노출 순서. "AB" = 문항뱅크 choices[0]이 먼저(왼쪽/위), "BA" = choices[1]이 먼저. */
export type MbtiOptionOrder = "AB" | "BA";

export interface MbtiQuestionSelection {
  /** 20문항의 최종 화면 노출 순서(같은 축이 연속되지 않도록 배치됨). */
  questionOrder: readonly string[];
  /** 선정된 20문항 ID 집합(감사/디버깅 목적으로 questionOrder와 별도 저장). */
  selectedQuestionIds: readonly string[];
  /** 문항 ID → 그 문항의 고정 화면 좌우 순서. */
  optionOrder: Readonly<Record<string, MbtiOptionOrder>>;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/**
 * 문항 ID가 최근 세션들 중 몇 번째로 최근에 등장했는지(0=가장 최근) 반환한다.
 * 한 번도 등장하지 않았으면 null(재출제 회피 우선순위가 가장 높음 = 가장 신선한 후보).
 */
function recencyRank(
  questionId: string,
  recentSessionsQuestionIds: readonly (readonly string[])[],
): number | null {
  for (let i = 0; i < recentSessionsQuestionIds.length; i++) {
    if (recentSessionsQuestionIds[i]?.includes(questionId)) {
      return i;
    }
  }
  return null;
}

/**
 * 한 축의 50문항 후보 중 5문항을 뽑는다. 우선순위: (1) 최근 3세션 모두에서 미출제
 * (2) 가장 오래전 세션에서만 출제 (3) 그다음 오래전 (4) 가장 최근 세션에서 출제.
 * 각 우선순위 그룹 내부는 무작위로 섞는다(그룹 경계에서만 결정론적, 그룹 내부는 공정한
 * 무작위 추출).
 */
function pickAxisQuestions(
  axis: Axis,
  recentSessionsQuestionIds: readonly (readonly string[])[],
  random: () => number,
): readonly Question[] {
  const candidates = QUESTION_BANK.filter((q) => q.axis === axis);

  const groups = new Map<number, Question[]>(); // key: -1(미출제) | 0..N-1(recencyRank)
  for (const q of candidates) {
    const rank = recencyRank(q.id, recentSessionsQuestionIds);
    const key = rank === null ? -1 : rank;
    const group = groups.get(key) ?? [];
    group.push(q);
    groups.set(key, group);
  }

  // 우선순위 그룹 정렬: 미출제(-1) 먼저, 그다음 가장 오래전(rank가 큰 값)부터 최근(rank=0) 순.
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === -1) return -1;
    if (b === -1) return 1;
    return b - a; // rank 큰(오래전) 값이 먼저
  });

  const picked: Question[] = [];
  for (const key of orderedKeys) {
    if (picked.length >= QUESTIONS_PER_AXIS) break;
    const shuffled = shuffle(groups.get(key) ?? [], random);
    for (const q of shuffled) {
      if (picked.length >= QUESTIONS_PER_AXIS) break;
      picked.push(q);
    }
  }

  if (picked.length < QUESTIONS_PER_AXIS) {
    throw new Error(
      `${axis} 축 후보가 ${QUESTIONS_PER_AXIS}문항보다 부족합니다(문항뱅크 크기 확인 필요). 확보: ${picked.length}`,
    );
  }

  return picked;
}

/**
 * 축별로 뽑은 문항들을 20문항 하나의 순서로 합치되, 같은 축이 연속되지 않게 배치한다.
 *
 * "남은 개수가 가장 많은 축(동률이면 무작위) 우선, 단 그게 바로 직전 축이면 그다음으로
 * 많이 남은 축을 대신 선택" 방식이다(LeetCode 767 "Reorganize String"류 문제의 정석
 * 그리디 해법을 4개 그룹으로 일반화한 것). 단순히 "직전 축만 아니면 아무 후보나 무작위
 * 선택"하는 방식은 국소적으로는 안전해 보여도 뒷부분에서 특정 축만 남아 막다른 길에
 * 몰릴 수 있다(실제로 발견됨 — 테스트로 재현). "가장 많이 남은 축 우선"은 남은 문항이
 * 한쪽 축에 쏠리지 않게 계속 소진시켜, 각 축이 정확히 5개씩(최댓값 5 ≤ ⌈20/4⌉=5)인 이
 * 조건에서 항상 끝까지 인접 중복 없이 완주 가능함이 보장된다.
 *
 * 같은 이미지 연속 방지: 200문항이 20장의 일러스트를 다대일로 공유하므로, 서로 다른
 * 축의 두 문항이 우연히 같은 imagePath를 가리키면 축 연속 회피만으로는 같은 이미지가
 * 화면에 바로 이어서 나올 수 있다(실제로 5세션 라이브 검증에서 재현됨). 축을 고른 뒤
 * 그 축의 남은 후보 중 직전에 놓인 문항과 이미지가 다른 것을 우선 선택하고, 그런
 * 후보가 없을 때만(같은 축 내 남은 문항 전부가 직전과 같은 이미지인 극단적 경우)
 * 어쩔 수 없이 맨 앞 문항을 그대로 쓴다.
 */
function interleaveWithoutConsecutiveAxis(
  axisPicks: Readonly<Record<Axis, readonly Question[]>>,
  random: () => number,
): Question[] {
  const remaining = new Map<Axis, Question[]>(
    AXES.map((axis) => [axis, [...axisPicks[axis]]]),
  );
  const result: Question[] = [];
  let lastAxis: Axis | null = null;
  let lastImage: string | undefined;
  const total = AXES.length * QUESTIONS_PER_AXIS;

  for (let i = 0; i < total; i++) {
    const candidates = shuffle(
      AXES.filter((axis) => (remaining.get(axis)?.length ?? 0) > 0),
      random,
    ).sort((a, b) => remaining.get(b)!.length - remaining.get(a)!.length);

    let axis = candidates[0]!;
    if (axis === lastAxis && candidates.length > 1) {
      axis = candidates[1]!;
    }

    const pool = remaining.get(axis)!;
    const differentImageIndex = pool.findIndex((q) => q.imagePath !== lastImage);
    const pickIndex = differentImageIndex === -1 ? 0 : differentImageIndex;
    const [next] = pool.splice(pickIndex, 1);
    result.push(next!);
    lastAxis = axis;
    lastImage = next!.imagePath;
  }

  return repairConsecutiveImages(result);
}

/**
 * 위 그리디 배치는 "같은 축 안"에서만 다른 이미지 대안을 찾으므로, 특정 이미지가 한
 * 축에 유독 몰려 있으면(실제로 200문항 매핑에서 발생 — 예: JP 축에 특정 이미지가
 * 여러 개 배정된 경우) 축은 다르지만 이미지가 같은 두 문항이 여전히 연속될 수 있다
 * (300 시드 스트레스 테스트로 실제 재현됨). 이 함수는 완성된 20문항 순서 전체를
 * 훑으며 남은 위반을 찾아, 뒤쪽에서 축·이미지 제약을 모두 지키면서 자리를 바꿀 수
 * 있는 문항을 찾아 스왑한다(전역 탐색이라 국소 수정보다 해결 가능성이 훨씬 높다).
 */
function repairConsecutiveImages(order: Question[]): Question[] {
  const result = [...order];

  const violatesAt = (arr: Question[], i: number): boolean =>
    i > 0 && !!arr[i]!.imagePath && arr[i]!.imagePath === arr[i - 1]!.imagePath;

  const canSwap = (arr: Question[], i: number, j: number): boolean => {
    const swapped = [...arr];
    [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
    for (const idx of [i - 1, i, i + 1, j - 1, j, j + 1]) {
      if (idx <= 0 || idx >= swapped.length) continue;
      if (swapped[idx]!.axis === swapped[idx - 1]!.axis) return false;
      if (swapped[idx]!.imagePath && swapped[idx]!.imagePath === swapped[idx - 1]!.imagePath) return false;
    }
    return true;
  };

  for (let i = 1; i < result.length; i++) {
    if (!violatesAt(result, i)) continue;

    let fixed = false;
    // 전략 1: 위반 지점의 뒤쪽 문항(i)을 더 뒤(j)에 있는 문항과 바꾼다.
    for (let j = i + 1; j < result.length && !fixed; j++) {
      if (canSwap(result, i, j)) {
        const tmp = result[i]!;
        result[i] = result[j]!;
        result[j] = tmp;
        fixed = true;
      }
    }
    // 전략 2(전략 1 실패 시): 위반 지점의 앞쪽 문항(i-1)을 더 앞쪽(k)에 있는 문항과
    // 바꿔 위반 자체를 다른 조합으로 해소한다 — 전략 1이 막다른 경우를 보완한다.
    for (let k = 0; k < i - 1 && !fixed; k++) {
      if (canSwap(result, i - 1, k)) {
        const tmp = result[i - 1]!;
        result[i - 1] = result[k]!;
        result[k] = tmp;
        fixed = true;
      }
    }
    // 두 전략 모두 실패하면(구조적으로 극히 드문 경우) 이 한 자리의 반복만 그대로
    // 남긴다 — 억지 스왑으로 다른 자리의 축/이미지 제약을 깨뜨리지 않는다.
  }

  return result;
}

export function selectMbtiQuestions(params: {
  recentSessionsQuestionIds: readonly (readonly string[])[];
  random?: () => number;
}): MbtiQuestionSelection {
  const random = params.random ?? Math.random;

  const axisPicks = Object.fromEntries(
    AXES.map((axis) => [axis, pickAxisQuestions(axis, params.recentSessionsQuestionIds, random)]),
  ) as Record<Axis, readonly Question[]>;

  const orderedQuestions = interleaveWithoutConsecutiveAxis(axisPicks, random);

  const optionOrder: Record<string, MbtiOptionOrder> = {};
  for (const q of orderedQuestions) {
    optionOrder[q.id] = random() < 0.5 ? "AB" : "BA";
  }

  const questionOrder = orderedQuestions.map((q) => q.id);

  return {
    questionOrder,
    selectedQuestionIds: [...questionOrder].sort(),
    optionOrder,
  };
}
