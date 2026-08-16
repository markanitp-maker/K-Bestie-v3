export const DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT = 5;

/**
 * RELATIONSHIP_MEMORY_PACK_LIMIT 환경변수로 조정.
 * 1 이상의 정수만 허용하며, 누락/잘못된 값이면 기본값으로 fail-safe하고 console.error로 로깅한다.
 */
export function loadRelationshipMemoryPackLimit(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  const targetEnv = env ?? (typeof process !== "undefined" ? process.env : {});
  const rawLimit = targetEnv.RELATIONSHIP_MEMORY_PACK_LIMIT;

  if (rawLimit === undefined || rawLimit === null) {
    return DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT;
  }

  if (typeof rawLimit !== "string" || rawLimit.trim() === "") {
    return DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT;
  }

  const parsed = Number(rawLimit.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `[memoryPackConfig] RELATIONSHIP_MEMORY_PACK_LIMIT 유효성 검증 실패(1 이상의 정수 필요). 기본값(${DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT})으로 복구합니다. 원문:`,
      rawLimit,
    );
    return DEFAULT_RELATIONSHIP_MEMORY_PACK_LIMIT;
  }

  return parsed;
}
