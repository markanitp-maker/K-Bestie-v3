// 퀴즈마스터 → 메인 앱 리워드 콜백 공용 인증 (requests/010 §작업2/3, §서버 간 인증)
//
// 두 콜백(POST /api/rewards/golden-key/refund, POST /api/quiz/completion) 모두
// 동일한 Bearer 시크릿 + Idempotency-Key 검증 규칙을 쓴다.

import crypto from "crypto";
import type { NextRequest } from "next/server";

export interface RewardsCallbackAuthResult {
  ok: boolean;
  status: number;
  error?: string;
}

// 010 §서버 간 인증: "Bearer token 비교 시 가능한 경우 timing-safe 비교를 사용한다."
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyRewardsCallbackAuth(
  req: NextRequest,
  rewardTransactionId: string,
): RewardsCallbackAuthResult {
  const secret = process.env.MAIN_APP_REWARDS_API_KEY;
  if (!secret) {
    console.error("[rewardCallbackAuth] MAIN_APP_REWARDS_API_KEY env not set");
    return { ok: false, status: 500, error: "not_configured" };
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!timingSafeStringEqual(auth, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const idempotencyKey = req.headers.get("idempotency-key") ?? "";
  if (!idempotencyKey || idempotencyKey !== rewardTransactionId) {
    return { ok: false, status: 400, error: "idempotency_key_mismatch" };
  }

  return { ok: true, status: 200 };
}

const MAX_TEXT_FIELD_LENGTH = 200;

// 010 §보안 검증: "reason은 허용 길이를 제한하고 로그 인젝션을 방지한다."
// 제어 문자(개행 등)를 제거하고 길이를 잘라, 로그·DB에 그대로 남아도 안전하게 만든다.
export function sanitizeExternalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TEXT_FIELD_LENGTH);
}
