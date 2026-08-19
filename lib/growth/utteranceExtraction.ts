// 요청서 013 §3-3 ~ §3-5 — 아이 발화에서 키·몸무게를 구조화 추출한다.
//
// 전부 결정론이다. LLM 을 부르지 않는다 — 이 판정이 틀리면 부모에게 잘못된 숫자가
// 올라가고, 대화 턴마다 추가 호출을 붙이면 아이가 기다린다.
//
// 이 모듈이 하는 일은 "후보를 만드는 것"뿐이다. 공식 기록으로 만드는 결정은 부모가 한다(§5-1).
// 그래서 애매하면 후보를 만들지 않는 쪽으로 기운다 — 놓친 값은 부모가 직접 입력하면 되지만,
// 잘못 만든 후보는 부모가 하나씩 지워야 한다.

import { HEIGHT_CM_RANGE, WEIGHT_KG_RANGE } from "./validation";

export type GrowthMeasurementType = "height" | "weight";
export type GrowthCandidateConfidence = "high" | "low";

export interface GrowthUtteranceCandidate {
  measurementType: GrowthMeasurementType;
  /** 소수 한 자리로 정규화된 값. */
  value: number;
  unit: "cm" | "kg";
  confidence: GrowthCandidateConfidence;
  /** 아이가 말한 숫자 표현 조각. 문장 전체가 아니다(§3-3 개인정보 최소화). */
  rawValueText: string;
}

export interface ExtractGrowthCandidatesInput {
  /** 아이의 이번 발화. */
  utterance: string;
  /**
   * 직전 K 발화. 아이가 단위 없이 숫자만 말했을 때(예: "142") 무엇을 물었는지 알아야
   * 키인지 몸무게인지 정할 수 있다(§3-3, §6-1). 없으면 단위 없는 숫자는 버린다.
   */
  previousKUtterance?: string | null;
}

/** 소수점 한 자리까지만 남긴다. growth_measurements NUMERIC(4,1) 과 같은 규격이다(§6-2). */
const normalize = (value: number): number => Math.round(value * 10) / 10;

/** 키 단위 표기. "센치"는 실제 아이 발화에서 흔하다. */
const HEIGHT_UNIT = "(?:cm|CM|Cm|센티미터|센치미터|센티|센치)";
const WEIGHT_UNIT = "(?:kg|KG|Kg|킬로그램|킬로그람|킬로|킬로그램|kg)";

/**
 * 불확실 표현(§3-4). 이게 값 근처에 있으면 high 로 올리지 않는다.
 * "138이라고 했던 것 같아"처럼 문장 어디에 있어도 잡히도록 문장 전체에서 본다.
 */
const UNCERTAIN_MARKERS = [
  /쯤/,
  /정도/,
  /인가/,
  /일걸/,
  /아마/,
  /같아/,
  /같은데/,
  /인\s*것\s*같/,
  /잘\s*모르/,
  /모르겠/,
  /했던\s*것?\s*같/,
  /라고\s*했/,
  /들었/,
  /기억/,
  /대충/,
  /한\s*(?:1[0-9]{2}|[0-9]{1,2})\b/,
  /\?/,
];

/** 미래·가정 표현. "키 150 되고 싶어" 같은 말은 측정값이 아니다. */
const NON_MEASUREMENT_MARKERS = [
  /되고\s*싶/,
  /하고\s*싶/,
  /됐으면/,
  /되면\s*좋/,
  /목표/,
  /작년|재작년/,
  /예전|옛날/,
];

const hasUncertainty = (text: string): boolean =>
  UNCERTAIN_MARKERS.some((pattern) => pattern.test(text));

const isNonMeasurement = (text: string): boolean =>
  NON_MEASUREMENT_MARKERS.some((pattern) => pattern.test(text));

const inRange = (type: GrowthMeasurementType, value: number): boolean =>
  type === "height"
    ? value >= HEIGHT_CM_RANGE.min && value <= HEIGHT_CM_RANGE.max
    : value >= WEIGHT_KG_RANGE.min && value <= WEIGHT_KG_RANGE.max;

/**
 * 초등학생(만 6~13세)에게 현실적인 범위(§3-5).
 *
 * DB CHECK 범위(30~250cm / 2~200kg)는 명백한 입력 실수만 막는 넓은 범위다. 아이 발화는
 * 부모 입력보다 오인이 잦으므로(단위 혼동, STT 오인식) 후보 생성 단계에서 한 겹 더 좁힌다.
 * 이 범위는 건강 판정이 아니라 "이 서비스 대상 연령의 아이가 말할 법한 숫자인가" 만 본다.
 * 대상 연령 정보는 lib/growth/consent.ts ELEMENTARY_AGE_MONTHS 와 같은 근거다.
 */
export const PLAUSIBLE_CHILD_HEIGHT_CM = { min: 90, max: 190 } as const;
export const PLAUSIBLE_CHILD_WEIGHT_KG = { min: 10, max: 120 } as const;

const isPlausibleForChild = (type: GrowthMeasurementType, value: number): boolean =>
  type === "height"
    ? value >= PLAUSIBLE_CHILD_HEIGHT_CM.min && value <= PLAUSIBLE_CHILD_HEIGHT_CM.max
    : value >= PLAUSIBLE_CHILD_WEIGHT_KG.min && value <= PLAUSIBLE_CHILD_WEIGHT_KG.max;

/**
 * K 가 직전에 무엇을 물었는지. 단위 없는 숫자의 종류를 정하는 데만 쓴다(§6-1).
 * 둘 다 물었으면 null 이다 — 어느 쪽인지 단정할 수 없다.
 */
export function inferAskedMeasurementType(
  previousKUtterance: string | null | undefined
): GrowthMeasurementType | null {
  if (!previousKUtterance) return null;
  const text = previousKUtterance;
  const asksHeight = /키/.test(text);
  const asksWeight = /몸무게|체중/.test(text);
  if (asksHeight && asksWeight) return null;
  if (asksHeight) return "height";
  if (asksWeight) return "weight";
  return null;
}

interface RawMatch {
  type: GrowthMeasurementType;
  value: number;
  rawValueText: string;
  index: number;
}

/** 단위가 붙은 값. 가장 확실한 형태다. */
function matchWithUnit(utterance: string): RawMatch[] {
  const matches: RawMatch[] = [];
  const patterns: Array<{ type: GrowthMeasurementType; regex: RegExp }> = [
    { type: "height", regex: new RegExp(`(\\d{1,3}(?:\\.\\d)?)\\s*${HEIGHT_UNIT}`, "g") },
    { type: "weight", regex: new RegExp(`(\\d{1,3}(?:\\.\\d)?)\\s*${WEIGHT_UNIT}`, "g") },
  ];
  for (const { type, regex } of patterns) {
    for (const match of utterance.matchAll(regex)) {
      matches.push({
        type,
        value: Number(match[1]),
        rawValueText: match[0].trim(),
        index: match.index ?? 0,
      });
    }
  }
  return matches;
}

/** 그 종류와 모순되는 단위가 숫자 바로 뒤에 붙어 있는지. "키 142kg" 같은 경우다(시나리오 D). */
const CONFLICTING_UNIT: Record<GrowthMeasurementType, RegExp> = {
  height: new RegExp(`^\\s*${WEIGHT_UNIT}`),
  weight: new RegExp(`^\\s*${HEIGHT_UNIT}`),
};

/**
 * 단위 없이 "키 142", "몸무게 38" 처럼 단어가 앞에 붙은 값.
 * 단어와 숫자 사이에 다른 숫자가 끼면 잡지 않는다.
 *
 * 숫자 뒤에 반대 종류의 단위가 붙어 있으면 버린다 — "키 142kg" 은 아이가 단위를 잘못 말한
 * 것이고, 단어(키)만 보고 142cm 로 저장하면 틀린 값이 부모에게 올라간다(§5-6, 시나리오 D).
 */
function matchWithKeyword(utterance: string): RawMatch[] {
  const matches: RawMatch[] = [];
  const patterns: Array<{ type: GrowthMeasurementType; regex: RegExp }> = [
    { type: "height", regex: /키[^0-9]{0,6}(\d{1,3}(?:\.\d)?)/g },
    { type: "weight", regex: /(?:몸무게|체중)[^0-9]{0,6}(\d{1,3}(?:\.\d)?)/g },
  ];
  for (const { type, regex } of patterns) {
    for (const match of utterance.matchAll(regex)) {
      const after = utterance.slice((match.index ?? 0) + match[0].length);
      if (CONFLICTING_UNIT[type].test(after)) continue;
      matches.push({
        type,
        value: Number(match[1]),
        rawValueText: match[0].trim(),
        index: match.index ?? 0,
      });
    }
  }
  return matches;
}

/**
 * 단위도 단어도 없는 숫자. K 가 방금 물어본 종류가 명확할 때만 쓴다(§6-1).
 * 여러 숫자가 있으면 마지막 것을 현재값으로 본다 — "지난번엔 140이었고 지금은 142야"(§6-3).
 */
function matchBareNumber(
  utterance: string,
  askedType: GrowthMeasurementType | null
): RawMatch[] {
  if (!askedType) return [];
  const numbers = [...utterance.matchAll(/(\d{1,3}(?:\.\d)?)/g)];
  if (numbers.length === 0) return [];
  const last = numbers[numbers.length - 1];
  return [{
    type: askedType,
    value: Number(last[1]),
    rawValueText: last[0],
    index: last.index ?? 0,
  }];
}

/**
 * 아이 발화에서 키·몸무게 후보를 뽑는다.
 *
 * 반환하지 않는 경우(= 후보 없음):
 *   - 숫자가 없다
 *   - 단위/단어가 없고 K 가 무엇을 물었는지도 불명확하다
 *   - 값이 초등학생에게 현실적인 범위 밖이다(§3-5, 시나리오 D)
 *   - 측정값이 아닌 문장이다(희망·과거 회상)
 *
 * 종류당 하나만 돌려준다. 같은 종류가 여러 번 나오면 마지막 값이 현재값이다(§6-3).
 */
export function extractGrowthCandidates(
  input: ExtractGrowthCandidatesInput
): GrowthUtteranceCandidate[] {
  const utterance = input.utterance?.trim() ?? "";
  if (!utterance || !/\d/.test(utterance)) return [];
  if (isNonMeasurement(utterance)) return [];

  const askedType = inferAskedMeasurementType(input.previousKUtterance);

  const unitMatches = matchWithUnit(utterance);
  const keywordMatches = matchWithKeyword(utterance);

  // 단위가 붙은 값이 하나라도 있으면 맨숫자 추정은 하지 않는다 — 이미 근거가 있다.
  const explicit = [...unitMatches, ...keywordMatches];
  const raw = explicit.length > 0 ? explicit : matchBareNumber(utterance, askedType);
  if (raw.length === 0) return [];

  const uncertain = hasUncertainty(utterance);

  const byType = new Map<GrowthMeasurementType, RawMatch>();
  for (const match of raw) {
    // 시나리오 D — 단위 혼동("키 142kg", "몸무게 38cm")과 비현실 범위는 후보로 만들지 않는다.
    if (!inRange(match.type, match.value)) continue;
    if (!isPlausibleForChild(match.type, match.value)) continue;
    const existing = byType.get(match.type);
    // 같은 종류가 여러 번이면 문장 뒤쪽(= 현재값)을 남긴다.
    if (!existing || match.index >= existing.index) byType.set(match.type, match);
  }

  return [...byType.entries()].map(([type, match]) => ({
    measurementType: type,
    value: normalize(match.value),
    unit: type === "height" ? "cm" : "kg",
    confidence: uncertain ? "low" : "high",
    rawValueText: match.rawValueText.slice(0, 40),
  }));
}
