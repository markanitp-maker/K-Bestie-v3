// 퀴즈마스터 프로젝트에서 포팅 — 리더보드 login_id 마스킹(코드 포인트 기준, 별표 항상 3개).

export function maskUserId(loginId: string | null | undefined): string {
  if (loginId == null) return "";

  const codePoints = Array.from(loginId);
  if (codePoints.length === 0) return "";

  const revealCount = codePoints.length >= 5 ? 3 : codePoints.length === 4 ? 2 : 1;

  return codePoints.slice(0, revealCount).join("") + "***";
}
