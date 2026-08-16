export const DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS = 3;

/**
 * RELATIONSHIP_RETURN_GAP_DAYS 환경변수로 조정.
 * 1 이상의 정수만 허용하며, 누락/잘못된 값이면 기본값으로 fail-safe하고 console.error로 로깅한다.
 */
export function loadRelationshipReturnGapDays(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  const targetEnv = env ?? (typeof process !== "undefined" ? process.env : {});
  const rawValue = targetEnv.RELATIONSHIP_RETURN_GAP_DAYS;

  if (rawValue === undefined || rawValue === null) {
    return DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS;
  }

  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS;
  }

  const parsed = Number(rawValue.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `[returnGapConfig] RELATIONSHIP_RETURN_GAP_DAYS 유효성 검증 실패(1 이상의 정수 필요). 기본값(${DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS})으로 복구합니다. 원문:`,
      rawValue,
    );
    return DEFAULT_RELATIONSHIP_RETURN_GAP_DAYS;
  }

  return parsed;
}
