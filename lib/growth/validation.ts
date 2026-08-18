// 성장정보 입력 검증 (요청서 012 §3-2, §3-4).
// 서버 라우트와 입력 화면이 같은 규칙을 쓰도록 한 곳에 둔다.
//
// 허용 범위는 "성장 여부 판단"이 아니라 명백한 입력 실수(단위 혼동·오타)만 막는 넓은 범위다.
// DB CHECK 제약(20260818230000_child_growth_profiles_and_measurements.sql)과 같은 값을 쓴다.

import { calculateAgeInMonths, isFutureDate, parseDateOnly } from "./age";

export const HEIGHT_CM_RANGE = { min: 30, max: 250 } as const;
export const WEIGHT_KG_RANGE = { min: 2, max: 200 } as const;

export interface ValidationFailure {
  field: "birthDate" | "gender" | "measuredAt" | "heightCm" | "weightKg" | "consent";
  message: string;
}

/** 소수 한 자리까지만 허용하고 그 값을 그대로 반환한다. */
export function normalizeMeasurementValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.round(parsed * 10) / 10;
}

export function validateBirthDate(birthDate: unknown): ValidationFailure | null {
  if (typeof birthDate !== "string" || !parseDateOnly(birthDate)) {
    return { field: "birthDate", message: "생년월일을 정확히 입력해 주세요." };
  }
  if (isFutureDate(birthDate)) {
    return { field: "birthDate", message: "생년월일은 오늘 이후일 수 없어요." };
  }
  return null;
}

export function validateGender(gender: unknown): ValidationFailure | null {
  if (gender !== "male" && gender !== "female") {
    return { field: "gender", message: "성별을 선택해 주세요." };
  }
  return null;
}

export interface MeasurementInputPayload {
  measuredAt: string;
  heightCm: number | null;
  weightKg: number | null;
}

/**
 * 측정 입력값을 검증하고 정규화한다.
 * birthDate 를 함께 받아 측정일이 생년월일보다 이른 경우를 막는다.
 */
export function validateMeasurementInput(
  raw: { measuredAt?: unknown; heightCm?: unknown; weightKg?: unknown },
  birthDate: string
): { ok: true; value: MeasurementInputPayload } | { ok: false; failure: ValidationFailure } {
  const measuredAt = typeof raw.measuredAt === "string" ? raw.measuredAt.trim() : "";
  if (!parseDateOnly(measuredAt)) {
    return { ok: false, failure: { field: "measuredAt", message: "측정일을 정확히 입력해 주세요." } };
  }
  if (isFutureDate(measuredAt)) {
    return { ok: false, failure: { field: "measuredAt", message: "측정일은 오늘 이후일 수 없어요." } };
  }
  if (calculateAgeInMonths(birthDate, measuredAt) === null) {
    return {
      ok: false,
      failure: { field: "measuredAt", message: "측정일이 생년월일보다 이를 수 없어요." },
    };
  }

  const heightCm = normalizeMeasurementValue(raw.heightCm);
  const weightKg = normalizeMeasurementValue(raw.weightKg);

  if (heightCm !== null && Number.isNaN(heightCm)) {
    return { ok: false, failure: { field: "heightCm", message: "키는 숫자로 입력해 주세요." } };
  }
  if (weightKg !== null && Number.isNaN(weightKg)) {
    return { ok: false, failure: { field: "weightKg", message: "몸무게는 숫자로 입력해 주세요." } };
  }
  if (heightCm === null && weightKg === null) {
    return {
      ok: false,
      failure: { field: "heightCm", message: "키와 몸무게 중 하나는 입력해 주세요." },
    };
  }
  if (heightCm !== null && (heightCm < HEIGHT_CM_RANGE.min || heightCm > HEIGHT_CM_RANGE.max)) {
    return {
      ok: false,
      failure: {
        field: "heightCm",
        message: `키는 ${HEIGHT_CM_RANGE.min}~${HEIGHT_CM_RANGE.max}cm 사이로 입력해 주세요.`,
      },
    };
  }
  if (weightKg !== null && (weightKg < WEIGHT_KG_RANGE.min || weightKg > WEIGHT_KG_RANGE.max)) {
    return {
      ok: false,
      failure: {
        field: "weightKg",
        message: `몸무게는 ${WEIGHT_KG_RANGE.min}~${WEIGHT_KG_RANGE.max}kg 사이로 입력해 주세요.`,
      },
    };
  }

  return { ok: true, value: { measuredAt, heightCm, weightKg } };
}
