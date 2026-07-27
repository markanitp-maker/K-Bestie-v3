/**
 * app/child/play/page.tsx(`/api/quiz/start-handoff` 성공)에서 독립 Quiz 앱으로
 * handoff token을 넘기는 채널. lib/play/mbtiSessionHandoff.ts와 동일한 이유로 URL
 * 쿼리 파라미터가 아니라 sessionStorage로만 전달한다 — token은 1회만 소비 가능한
 * 캐퍼빌리티 값이라 브라우저 히스토리·서버 접근 로그에 남기지 않는다.
 *
 * `/play/quiz`는 리버스 프록시를 통해 same-origin으로 서빙되므로, origin-scoped인
 * sessionStorage를 Quiz 앱이 그대로 읽을 수 있다.
 *
 * 계획 Phase 7.1: 인앱 중복 구현(app/play/quiz/page.tsx,
 * components/quiz/QuizPlayScreen.tsx)이 삭제되면서 `readQuizSessionHandoff` /
 * `attachAttemptIdToQuizSessionHandoff` / `clearQuizSessionHandoff` 3개는 호출자가
 * 0이 되어 함께 정리했다(`clearQuizSessionHandoff`는 그 전부터 호출부가 없는 죽은
 * 코드였다). 이제 읽는 쪽은 Quiz 앱이 자기 코드로 처리한다 — K-Bestie는 쓰기만 한다.
 */

const STORAGE_KEY = "k_quiz_active_handoff";

export interface QuizSessionHandoff {
  token: string;
  childId: string;
  /**
   * 이어하기 진입 시 재개할 기존 attempt. 신규 시작 경로에서는 비어 있다.
   * (Quiz 앱은 이 값 또는 `?resume=` 쿼리로 재개 대상을 판단한다.)
   */
  attemptId?: string;
}

export function writeQuizSessionHandoff(value: QuizSessionHandoff): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
