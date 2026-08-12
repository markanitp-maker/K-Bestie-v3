const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);

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
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl("/api/mission/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mission-turn-attempt": String(attempt),
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lastError = error;
      if (attempt === maxAttempts) {
        const requestError = new Error(error instanceof Error ? error.message : "Mission turn request failed");
        requestError.name = "MissionTurnRequestError";
        throw requestError;
      }
    }
    await wait(baseDelayMs * attempt);
  }
  throw lastError ?? new Error("Mission turn request failed");
}
