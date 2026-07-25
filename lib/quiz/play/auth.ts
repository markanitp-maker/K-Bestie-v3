import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { QuizAttemptRow } from "./types";

/**
 * requests/021 — 퀴즈마스터 프로젝트 lib/quiz/auth.ts에서 포팅.
 *
 * 원본은 퀴즈마스터 전용 Supabase 세션(handoff token→verifyOtp로 발급)을 게이트1로
 * 썼지만, 이제 퀴즈 실행 자체가 K-Bestie 내부에서 돌아가므로 게이트1은 K-Bestie
 * 자신의 로그인 세션(@/lib/supabase/server의 createClient, 다른 K-Bestie API 라우트와
 * 완전히 동일한 인증 방식)을 그대로 쓴다. 게이트2(attempt 소유권 + 기기 잠금 + 6시간
 * 만료)는 원본과 동일 - quiz_attempts 테이블/컬럼이 그대로이므로 로직 변경 없음.
 */

const ATTEMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type AttemptAuthErrorCode =
  | "UNAUTHENTICATED"
  | "ATTEMPT_NOT_FOUND"
  | "FORBIDDEN"
  | "DEVICE_TAKEOVER"
  | "ATTEMPT_EXPIRED";

const ERROR_STATUS: Record<AttemptAuthErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ATTEMPT_NOT_FOUND: 404,
  FORBIDDEN: 403,
  DEVICE_TAKEOVER: 409,
  ATTEMPT_EXPIRED: 410,
};

/** K-Bestie 자신의 로그인 세션에서 user_id를 읽는다(getUser()로 재검증, getSession() 아님). */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) return null;
  return data.user.id;
}

export type VerifyAttemptSessionResult =
  | { ok: true; attempt: QuizAttemptRow }
  | {
      ok: false;
      code: Extract<
        AttemptAuthErrorCode,
        "ATTEMPT_NOT_FOUND" | "FORBIDDEN" | "ATTEMPT_EXPIRED" | "DEVICE_TAKEOVER"
      >;
    };

export async function verifyAttemptSession(params: {
  attemptId: string;
  sessionToken: string;
  userId: string;
}): Promise<VerifyAttemptSessionResult> {
  const { attemptId, sessionToken, userId } = params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`verifyAttemptSession: ${error.message}`);
  if (!data) return { ok: false, code: "ATTEMPT_NOT_FOUND" };

  const attempt = data as QuizAttemptRow;

  if (attempt.user_id !== userId) return { ok: false, code: "FORBIDDEN" };

  const ageMs = Date.now() - new Date(attempt.started_at).getTime();
  if (ageMs > ATTEMPT_MAX_AGE_MS) return { ok: false, code: "ATTEMPT_EXPIRED" };

  if (attempt.session_token !== sessionToken) return { ok: false, code: "DEVICE_TAKEOVER" };

  return { ok: true, attempt };
}

export type RequireAttemptAuthResult =
  | { ok: true; userId: string; attempt: QuizAttemptRow }
  | { ok: false; status: number; code: AttemptAuthErrorCode };

export async function requireAttemptAuth(params: {
  attemptId: string;
  sessionToken: string;
}): Promise<RequireAttemptAuthResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, status: ERROR_STATUS.UNAUTHENTICATED, code: "UNAUTHENTICATED" };
  }

  const result = await verifyAttemptSession({ ...params, userId });
  if (!result.ok) {
    return { ok: false, status: ERROR_STATUS[result.code], code: result.code };
  }

  return { ok: true, userId, attempt: result.attempt };
}
