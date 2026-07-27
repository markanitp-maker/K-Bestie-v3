/**
 * `/play/quiz` reverse-proxy has-게이트 (계획 `.omc/plans/quizmaster-resplit-plan.md` Phase 4).
 *
 * 게이트가 켜지면 `/play/quiz/**` 요청은 K-Bestie-v3 인앱 구현(`app/play/quiz/page.tsx`)이
 * 아니라 독립 Quiz Vercel 배포로 리버스 프록시된다. 게이트가 꺼져 있으면(기본값) 기존
 * 인앱 구현이 그대로 서빙된다 — Phase 4.6에 따라 컷오버는 "기본값만 전환"이고, 게이트
 * 코드와 레거시 페이지는 Phase 7 캐너리 통과 전까지 그대로 남겨 즉시 롤백 가능성을
 * 실제로 유지한다.
 *
 * middleware(edge)와 프록시 Route Handler(node) 양쪽에서 같은 판정을 써야 하므로
 * 순수 함수로 분리한다 — 두 곳의 판정이 갈라지면 게이트 OFF인데 프록시가 응답하거나
 * 그 반대인 상태가 생긴다.
 */

/** 사용자에게 보이는 경로 prefix. */
export const QUIZ_PROXY_PATH_PREFIX = "/play/quiz";

/**
 * middleware가 rewrite해 넣는 내부 경로 prefix.
 *
 * 프록시 Route Handler를 `app/play/quiz/[[...path]]/route.ts`에 두지 못하는 이유:
 * Phase 4.6이 레거시 `app/play/quiz/page.tsx`를 Phase 7까지 남겨두도록 요구하는데,
 * Next.js는 static route와 그 optional catch-all이 같은 경로로 해석되면 빌드를
 * 실패시킨다("You cannot define a route with the same specificity as a optional
 * catch-all route"). 그래서 핸들러를 충돌하지 않는 내부 경로에 두고 middleware가
 * 여기로 rewrite한다 — 사용자에게 보이는 URL은 계획대로 `/play/quiz` 그대로다.
 */
export const QUIZ_PROXY_INTERNAL_PREFIX = "/api/quiz-proxy";

/**
 * Quiz 앱이 치명적 오류(세션 만료 등)로 놀이를 계속할 수 없을 때 사용자를 되돌려보내는
 * K-Bestie 쪽 수신 경로.
 *
 * **반드시 `/play/quiz`의 하위가 아니어야 한다.** 하위였다면 middleware가 이 경로까지
 * 업스트림으로 프록시해버려서 K-Bestie가 화면을 그릴 수 없다. 반대로 형제 경로라서
 * 프록시 Route Handler의 Location 검사(basePath 안쪽만 허용)에는 자동으로 통과하지
 * 못하므로, 그쪽에서 이 경로만 명시적으로 예외 허용한다.
 */
export const QUIZ_ERROR_PATH = "/play/quiz-error";

/** `/play/quiz` 및 그 하위(정적 자산·API 포함) 경로인지. */
export function isQuizProxyPath(pathname: string): boolean {
  return (
    pathname === QUIZ_PROXY_PATH_PREFIX ||
    pathname.startsWith(`${QUIZ_PROXY_PATH_PREFIX}/`)
  );
}
