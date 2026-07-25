/**
 * requests/021 — app/child/play/page.tsx(/api/quiz/start-handoff 성공)에서
 * app/play/quiz/page.tsx로 handoff token을 넘기는 채널. lib/play/mbtiSessionHandoff.ts와
 * 동일한 이유로 URL 쿼리 파라미터가 아니라 sessionStorage로만 전달한다 - token은
 * /api/quiz-play/redeem에서 1회만 소비 가능한 캐퍼빌리티 값이라 브라우저 히스토리·
 * 서버 접근 로그에 남기지 않는다.
 */

const STORAGE_KEY = "k_quiz_active_handoff";

export interface QuizSessionHandoff {
  token: string;
  childId: string;
  /**
   * attempt 시작 성공 후 QuizPlayScreen이 채워 넣는다("이어하기" 시 window.location.reload()가
   * 페이지를 통째로 다시 마운트하므로, token(1회용, 이미 소비됨)이 아니라 이 attemptId로
   * 재개해야 한다 - token으로 다시 redeem을 시도하면 이미 consumed라 실패한다).
   */
  attemptId?: string;
}

export function writeQuizSessionHandoff(value: QuizSessionHandoff): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/** 기존 handoff에 attemptId만 추가로 기록한다(이어하기용, 토큰/childId는 그대로 유지). */
export function attachAttemptIdToQuizSessionHandoff(attemptId: string): void {
  if (typeof window === "undefined") return;
  const existing = readQuizSessionHandoff();
  if (!existing) return;
  writeQuizSessionHandoff({ ...existing, attemptId });
}

export function readQuizSessionHandoff(): QuizSessionHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuizSessionHandoff>;
    if (typeof parsed.token !== "string" || typeof parsed.childId !== "string") {
      return null;
    }
    return {
      token: parsed.token,
      childId: parsed.childId,
      attemptId: typeof parsed.attemptId === "string" ? parsed.attemptId : undefined,
    };
  } catch {
    return null;
  }
}

export function clearQuizSessionHandoff(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
