/**
 * app/child/play/page.tsx(consume 성공)에서 app/play/mbti/page.tsx로 세션 식별자를
 * 넘기는 핸드오프 채널. playSessionId는 쿠키 인증 없이 진행 저장/완료 API 쓰기를
 * 허용하는 캐퍼빌리티 토큰이므로 URL 쿼리 파라미터(브라우저 히스토리·서버 접근
 * 로그에 남는다)에 싣지 않고 sessionStorage로만 전달한다.
 */

const STORAGE_KEY = "k_mbti_active_session";

export interface MbtiSessionHandoff {
  sessionId: string;
  childId: string;
}

export function writeMbtiSessionHandoff(value: MbtiSessionHandoff): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function readMbtiSessionHandoff(): MbtiSessionHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MbtiSessionHandoff>;
    if (typeof parsed.sessionId !== "string" || typeof parsed.childId !== "string") {
      return null;
    }
    return { sessionId: parsed.sessionId, childId: parsed.childId };
  } catch {
    return null;
  }
}
