// requests/062, 063 — 관리자 리텐션 화면에서 부모/아이를 내부 UUID 대신
// "이름 (로그인 아이디)" 형식으로 표시하기 위한 공유 헬퍼. fallback 우선순위:
// 이름+로그인ID > 이름 > 로그인ID > 마스킹 UUID.

export function maskId(id: string): string {
  return `${id.substring(0, 8)}...`;
}

export function buildDisplayLabel(name: string | null | undefined, loginId: string | null | undefined, id: string): string {
  const n = name?.trim();
  const l = loginId?.trim();
  if (n && l) return `${n} (${l})`;
  if (n) return n;
  if (l) return l;
  return maskId(id);
}

export interface DisplayFields {
  name: string | null;
  loginId: string | null;
  displayLabel: string;
  maskedId: string;
}

export function toDisplayFields(id: string, name: string | null | undefined, loginId: string | null | undefined): DisplayFields {
  return {
    name: name?.trim() || null,
    loginId: loginId?.trim() || null,
    displayLabel: buildDisplayLabel(name, loginId, id),
    maskedId: maskId(id),
  };
}
