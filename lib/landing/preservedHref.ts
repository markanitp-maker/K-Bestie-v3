// 서버 컴포넌트(app/page.tsx)와 클라이언트 컴포넌트(BetaLandingPage.tsx) 양쪽에서
// 공유하는 순수 상수/함수. "use client" 파일에서 값을 export하면 서버 컴파일
// 단계에서 client reference proxy로 치환돼 서버 쪽에서 배열/함수로 쓸 수 없다
// (예: "X is not iterable" 빌드 오류) — 이를 피하기 위해 지시어 없는 별도 모듈로 둔다.

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type PreservedLandingParams = Partial<
  Record<(typeof UTM_KEYS)[number] | "returnUrl" | "link_id", string>
>;

export function buildPreservedHref(basePath: string, preservedParams: PreservedLandingParams): string {
  const destination = new URL(basePath, "http://landing.internal");
  for (const key of UTM_KEYS) {
    const value = preservedParams[key];
    if (value) destination.searchParams.set(key, value);
  }
  if (preservedParams.returnUrl) destination.searchParams.set("returnUrl", preservedParams.returnUrl);
  if (preservedParams.link_id) destination.searchParams.set("link_id", preservedParams.link_id);
  return `${destination.pathname}${destination.search}`;
}
