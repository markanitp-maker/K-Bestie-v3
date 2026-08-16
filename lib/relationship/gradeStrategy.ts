import { type GradeAdaptivePersona, resolveGradeAdaptivePersona } from "@/lib/persona/gradeAdaptivePersona";

/** Grade Strategy는 별도 데이터가 아니라 GradeAdaptivePersona 그 자체다(§11 중복 방지).
 *  Scenario Card는 이 진입점으로 참조한다. */
export type GradeStrategy = GradeAdaptivePersona;

export const GRADE_STRATEGY_VERSION = "v1";

export function resolveGradeStrategy(gradeRaw: string | number | null | undefined): GradeStrategy | null {
  return resolveGradeAdaptivePersona(gradeRaw);
}
