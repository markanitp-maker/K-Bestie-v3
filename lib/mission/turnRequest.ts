const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const CONFLICT_MAX_ATTEMPTS = 9;
// 409는 처리 중인 동일 턴을 조회하는 폴링이다. 기본 500ms 기준 누적 대기 14초로 제한해
// non-Live 20초 워치독 안에서 완료 응답을 기다리되 무한 폴링하지 않는다.
const CONFLICT_DELAY_MULTIPLIERS = [1, 2, 3, 4, 4, 4, 4, 6] as const;

export type MissionTurnRequestOptions = {
  body: Record<string, unknown>;
  signal?: AbortSignal;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postMissionTurnWithRetry({
  body,
  signal,
  maxAttempts = 4,
  baseDelayMs = 500,
  fetchImpl = fetch,
}: MissionTurnRequestOptions): Promise<Response> {
  let requestAttempt = 0;
  let retryableAttempt = 0;
  let conflictAttempt = 0;

  while (true) {
    requestAttempt += 1;
    try {
      const response = await fetchImpl("/api/mission/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mission-turn-attempt": String(requestAttempt),
        },
        body: JSON.stringify(body),
        signal,
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 409) {
        conflictAttempt += 1;
        if (conflictAttempt >= CONFLICT_MAX_ATTEMPTS) {
          return response;
        }
        await wait(baseDelayMs * CONFLICT_DELAY_MULTIPLIERS[conflictAttempt - 1]);
        continue;
      }

      if (!RETRYABLE_STATUS.has(response.status)) {
        return response;
      }

      retryableAttempt += 1;
      if (retryableAttempt >= maxAttempts) {
        return response;
      }
      await wait(baseDelayMs * retryableAttempt);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      retryableAttempt += 1;
      if (retryableAttempt >= maxAttempts) {
        const requestError = new Error(error instanceof Error ? error.message : "Mission turn request failed");
        requestError.name = "MissionTurnRequestError";
        throw requestError;
      }
      await wait(baseDelayMs * retryableAttempt);
    }
  }
}
