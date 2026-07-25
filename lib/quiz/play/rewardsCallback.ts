import "server-only";

/**
 * requests/021 — 퀴즈마스터 프로젝트의 lib/quiz/main-app-rewards.ts를 대체한다.
 *
 * 원본은 별도 배포(quizmaster-dev.vercel.app)에서 메인 앱(K-Bestie)의 완료/환불
 * 콜백을 외부 URL로 호출하도록 설계됐다. 이제 퀴즈 실행 자체가 K-Bestie 내부로
 * 포팅됐으므로 그 외부 호출은 같은 오리진 자기 자신 호출이 된다 - 그래도 계약
 * 자체("황금열쇠 소유권은 항상 메인 앱 쪽 코드가 갖고, 여기선 결과만 보고한다",
 * Bearer + Idempotency-Key 인증, reward_transaction_id 기준 멱등성)는 그대로 유지한다.
 * app/api/quiz/completion, app/api/rewards/golden-key/refund 두 라우트는 이 포팅
 * 작업에서 전혀 수정하지 않았다 - 그대로 재사용한다.
 */

const REQUEST_TIMEOUT_MS = 5_000;

export type MainAppRewardCallResult =
  | { ok: true }
  | {
      ok: false;
      reason: "NOT_CONFIGURED" | "NETWORK_ERROR" | "TIMEOUT" | "HTTP_ERROR";
      detail: string;
    };

export interface RefundRequestPayload {
  reward_transaction_id: string;
  user_id: string;
  child_id: string | null;
  quizmaster_attempt_id: string;
  reason: string;
}

export interface CompletionNotifyPayload {
  reward_transaction_id: string;
  user_id: string;
  child_id: string | null;
  quizmaster_attempt_id: string;
  score: number;
  completed_at: string;
}

/**
 * 자기 자신(K-Bestie) 호출용 base URL. NEXT_PUBLIC_APP_URL이 설정돼 있으면 그걸 쓰고,
 * 없으면 Vercel이 배포마다 자동 주입하는 VERCEL_URL(프로토콜 없이 호스트만)을 쓴다 -
 * 수동 env 설정 여부와 무관하게 배포 환경에서 항상 실제 도달 가능한 주소가 되도록
 * 이중 폴백을 둔다(로컬 개발에서만 최종적으로 localhost 사용).
 */
function getSelfBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function callSelfRewardsApi(
  path: string,
  idempotencyKey: string,
  body: unknown
): Promise<MainAppRewardCallResult> {
  const apiKey = process.env.MAIN_APP_REWARDS_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "NOT_CONFIGURED", detail: "MAIN_APP_REWARDS_API_KEY not set" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(new URL(path, getSelfBaseUrl()).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: "HTTP_ERROR", detail: `${res.status}: ${text.slice(0, 500)}` };
  }

  return { ok: true };
}

export async function requestRefund(
  payload: RefundRequestPayload
): Promise<MainAppRewardCallResult> {
  return callSelfRewardsApi(
    "/api/rewards/golden-key/refund",
    payload.reward_transaction_id,
    payload
  );
}

export async function notifyCompletion(
  payload: CompletionNotifyPayload
): Promise<MainAppRewardCallResult> {
  return callSelfRewardsApi("/api/quiz/completion", payload.reward_transaction_id, payload);
}
