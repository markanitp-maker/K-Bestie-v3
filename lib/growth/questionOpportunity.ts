// 요청서 013 §3-1, §3-2, §3-14 — 케이가 키·몸무게를 물어도 되는 순간인지 판정한다.
//
// 기본값은 "묻지 않는다" 다. 요청서가 금지한 것은 뜬금없는 신체정보 질문이고(§3-1),
// 몸무게는 키보다 더 민감하게 다루라고 못박았다(§3-14). 그래서 아이가 먼저 그쪽
// 이야기를 꺼냈을 때만 문이 열린다.
//
// 판정은 전부 결정론이고, 신호가 없으면 DB 를 조회하지 않는다 — 매 턴 왕복을 붙이면
// 아이가 기다린다(019 에서 배운 것).

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasRecentGrowthSignal } from "./candidates";
import type { GrowthMeasurementType } from "./utteranceExtraction";

/**
 * 같은 값을 다시 묻지 않을 기간(§3-2).
 *
 * 성장정보 v1 에 재질문 주기 정책이 없어 새로 정한다. 초등학생의 키는 한 달에 0.5cm
 * 안팎으로 자라 그보다 짧은 간격은 같은 값을 다시 묻는 것과 같다. 학교 신체검사가
 * 보통 학기당 한 번인 것도 같은 감각이다. 30일로 둔다.
 */
export const GROWTH_REASK_INTERVAL_DAYS = 30;

/** 아이가 키 이야기를 꺼냈다는 신호. 숫자가 아니라 화제 자체를 본다. */
const HEIGHT_CUES: readonly RegExp[] = [
  /키/,
  /(?:많이|엄청|훌쩍|부쩍)\s*(?:컸|자랐|큰)/,
  /(?:바지|옷|소매|신발)[^.?!]{0,10}(?:짧아|작아|안\s*맞)/,
  /신체검사|키\s*재/,
];

/** 몸무게 이야기 신호. 키보다 좁게 잡는다 — 오탐이 곧 민감한 질문이 된다(§3-14). */
const WEIGHT_CUES: readonly RegExp[] = [
  /몸무게/,
  /체중/,
  /몸무게\s*재/,
];

/**
 * 아이가 이 화제를 불편해했다는 신호. 하나라도 있으면 그 턴에는 묻지 않는다(§3-2, §3-14).
 * 재질문 억제는 값이 확보됐을 때(§3-2)와 별개로 필요하다 — 값을 못 받았어도 캐물으면 안 된다.
 */
const DECLINE_CUES: readonly RegExp[] = [
  /말하기\s*싫/,
  /말\s*안\s*할/,
  /비밀/,
  /묻지\s*마/,
  /그런\s*거\s*왜/,
  /싫어/,
  /부끄/,
  /창피/,
];

export interface GrowthQuestionOpportunity {
  /** 물어도 되는 종류. null 이면 이번 턴에는 묻지 않는다. */
  measurementType: GrowthMeasurementType | null;
  /** 프롬프트에 얹을 지침. measurementType 이 null 이면 undefined 다. */
  instruction?: string;
}

const NO_OPPORTUNITY: GrowthQuestionOpportunity = { measurementType: null };

/** 발화에 성장 화제 신호가 있는지만 본다. DB 조회 전 값싼 1차 필터다. */
export function detectGrowthTopicCue(utterance: string): GrowthMeasurementType | null {
  if (!utterance) return null;
  if (DECLINE_CUES.some((pattern) => pattern.test(utterance))) return null;
  // 몸무게를 먼저 본다 — "몸무게" 를 말했는데 키로 해석하면 엉뚱한 질문이 된다.
  if (WEIGHT_CUES.some((pattern) => pattern.test(utterance))) return "weight";
  if (HEIGHT_CUES.some((pattern) => pattern.test(utterance))) return "height";
  return null;
}

const buildInstruction = (measurementType: GrowthMeasurementType): string =>
  measurementType === "height"
    ? [
        "아이가 지금 키 이야기를 꺼냈어. 그 흐름에 자연스럽게 이어서 요즘 키를 재봤는지 한 번만 물어봐도 돼.",
        "숫자를 캐묻지 말고, 아이가 말하기 싫어하면 바로 넘어가.",
        "아이가 말한 숫자를 평가하거나 다른 사람과 비교하지 마.",
      ].join(" ")
    : [
        "아이가 지금 몸무게 이야기를 꺼냈어. 그 흐름에 자연스럽게 이어서 한 번만 물어봐도 돼.",
        "아이가 머뭇거리거나 말하기 싫어하면 바로 다른 이야기로 넘어가.",
        "몸무게를 평가하거나, 살·다이어트·외모 이야기를 꺼내거나, 다른 아이와 비교하지 마.",
      ].join(" ");

/**
 * 이번 턴에 케이가 키·몸무게를 물어도 되는지.
 *
 * 문이 열리는 조건은 전부 만족해야 한다:
 *   1. 아이가 이번 발화에서 그 화제를 꺼냈다 (뜬금없는 질문 금지 — §3-1)
 *   2. 아이가 그 화제를 거부하지 않았다 (§3-14)
 *   3. 부모가 성장정보를 설정해 뒀다 (안 쓰는 가정에 물어볼 이유가 없다)
 *   4. 최근에 같은 종류의 값을 확보하지 않았다 (§3-2)
 *
 * 조회 실패는 "묻지 않는다" 로 처리한다 — 묻지 않아 놓치는 것보다 잘못 묻는 쪽이 나쁘다.
 */
export async function resolveGrowthQuestionOpportunity(input: {
  db: SupabaseClient;
  childId: string;
  utterance: string;
}): Promise<GrowthQuestionOpportunity> {
  const measurementType = detectGrowthTopicCue(input.utterance);
  if (!measurementType) return NO_OPPORTUNITY;

  try {
    const { data: profile } = await input.db
      .from("child_growth_profiles")
      .select("child_id")
      .eq("child_id", input.childId)
      .maybeSingle();
    if (!profile) return NO_OPPORTUNITY;

    const alreadyKnown = await hasRecentGrowthSignal({
      db: input.db,
      childId: input.childId,
      measurementType,
      withinDays: GROWTH_REASK_INTERVAL_DAYS,
    });
    if (alreadyKnown) return NO_OPPORTUNITY;
  } catch (error) {
    console.error("[growth/questionOpportunity] 판정 실패 — 묻지 않는다", error);
    return NO_OPPORTUNITY;
  }

  return { measurementType, instruction: buildInstruction(measurementType) };
}
