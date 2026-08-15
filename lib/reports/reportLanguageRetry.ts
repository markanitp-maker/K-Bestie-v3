/**
 * Report Language Integrity Retry Helper
 *
 * Helpers to build retry instructions and failure error messages without
 * exposing raw conversation transcripts or violation samples.
 */

const MAX_REPORTED_VIOLATION_PATHS = 3;

/**
 * 재시도 프롬프트에 덧붙일 지시문. 위반 원문은 넣지 않는다.
 */
export function buildLanguageRetryInstruction(
  violations: Array<{ path: string; kind: string }>,
): string {
  if (!violations || violations.length === 0) {
    return "";
  }

  const violationDetails = violations
    .slice(0, MAX_REPORTED_VIOLATION_PATHS)
    .map((v) => `${v.path} (${v.kind})`)
    .join(", ");

  return `\n\n[언어 검증 재시도 지시]\n이전 생성 결과에서 언어 규칙 위반이 ${violations.length}건 감지되었습니다 (${violationDetails}).\n모든 문장은 일본어 문자(히라가나·가타카나)를 절대 사용하지 말고, 100% 자연스러운 한국어로만 다시 작성해 주세요.`;
}

/**
 * 최종 실패 에러 메시지. 위반 원문은 넣지 않는다.
 */
export function buildLanguageFailureMessage(
  violations: Array<{ path: string; kind: string }>,
): string {
  const count = violations?.length ?? 0;
  const pathSummary = (violations ?? [])
    .slice(0, MAX_REPORTED_VIOLATION_PATHS)
    .map((v) => `${v.path} (${v.kind})`)
    .join(", ");

  return `주간 리포트 언어 검증 실패: ${count}건 (${pathSummary})`;
}
