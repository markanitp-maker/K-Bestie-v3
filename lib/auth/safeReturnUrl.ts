export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const parsed = new URL(value, "https://app.k-bestie.com");
    if (parsed.origin !== "https://app.k-bestie.com") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

const AUTH_FLOW_PATHS = ["/login", "/signup", "/auth/callback"];

/**
 * 인증·회원상태 판정이 끝난 뒤에만 복원할 수 있는 내부 목적지를 반환한다.
 * 인증 화면 자체를 목적지로 허용하면 callback ↔ login/signup 순환이 생길 수 있다.
 */
export function safePostAuthReturnUrl(value: string | null | undefined): string {
  const safe = safeReturnUrl(value);
  const pathname = new URL(safe, "https://app.k-bestie.com").pathname;
  const isAuthFlowPath = AUTH_FLOW_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
  return isAuthFlowPath ? "/" : safe;
}
