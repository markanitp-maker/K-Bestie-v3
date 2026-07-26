import type { ReactNode } from "react";

/**
 * `/play/quiz`가 CDN에 캐시돼 has-게이트를 우회하던 버그 수정(E2E 발견).
 *
 * 증상: `quiz_proxy=on` 쿠키를 붙여도 `x-vercel-cache: HIT` + `x-nextjs-prerender: 1`로
 * 레거시 인앱 페이지가 그대로 서빙됐다(age 600초+, 캐시버스팅 쿼리도 무시). 즉 게이트가
 * 조용히 무력화된다.
 *
 * 원인은 "정적 프리렌더 페이지에는 middleware가 안 돈다"가 **아니다** — `/parent/home`도
 * 동일하게 정적 프리렌더(`○`)지만 middleware가 정상 동작해 `/login`으로 리다이렉트된다.
 * 실제 원인은 이 경로의 응답이 **쿠키에 따라 달라지는데도 공유 캐시에 저장 가능한 200**
 * 이었다는 점이다: 게이트 OFF 분기가 `NextResponse.next()`로 프리렌더된 200을 그대로
 * 내보내고, 그게 엣지 캐시에 저장되는 순간부터는 이후 요청이 캐시에서 바로 응답돼
 * 게이트 판정 자체가 일어나지 않는다.
 *
 * 그래서 프리렌더 자체를 없앤다. `page.tsx`가 `"use client"`라 라우트 세그먼트 설정을
 * 거기에 둘 수 없어, 서버 컴포넌트인 이 레이아웃에 둔다(세그먼트 설정은 하위 라우트에
 * 적용된다). Phase 7에서 레거시 페이지를 삭제할 때 이 파일도 함께 삭제하면 된다.
 *
 * middleware의 게이트 OFF 분기에도 `Cache-Control: private, no-store`를 걸어 이중으로
 * 막는다 — 향후 이 하위에 프리렌더 가능한 페이지가 추가돼도 같은 우회가 재발하지 않도록.
 */
export const dynamic = "force-dynamic";

export default function QuizGateLayout({ children }: { children: ReactNode }) {
  return children;
}
