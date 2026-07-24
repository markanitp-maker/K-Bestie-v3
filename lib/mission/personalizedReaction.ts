import { buildContentEchoReaction } from "@/lib/mission/eReactionPool";

export interface FetchPersonalizedReactionParams {
  questionText: string;
  answerText: string;
  sessionId: string;
  childTurnId: string;
  lastReaction: string | null;
  /** 이 호출이 더 이상 유효하지 않은지(예: 세션 재시작으로 epoch이 바뀜) 확인하는 함수.
   *  true를 반환하면 스트림을 취소하고 빈 문자열을 반환한다(호출부가 이 경우 결과를
   *  버리도록 기존 D/F 로직과 동일하게 처리해야 한다). */
  isStale: () => boolean;
  /** 첫 응답 조각이 도착한 시점에 호출(타이밍 계측용, 선택). */
  onFirstToken?: () => void;
  /** 첫 조각 대기 타임아웃(ms). 기본 2200 — 실측 p95=1558ms 기준 여유값. */
  timeoutMs?: number;
  /** 외부에서 이 요청을 취소할 수 있게 전달하는 AbortController. 전달하지 않으면
   *  함수 내부에서 새로 만든다(하위호환 — 이 파라미터 없이 호출하는 곳도 정상 동작). */
  abortController?: AbortController;
  /** 스트림 조각이 도착할 때마다(첫 조각 포함) 그 시점까지 누적된 텍스트를 그대로
   *  전달하는 콜백(선택). 실시간으로 화면에 반영하고 싶은 호출부만 넘기면 된다 —
   *  넘기지 않으면 아무 일도 안 한다(하위호환). */
  onChunk?: (accumulatedSoFar: string) => void;
}

/** D안(TestModeCDRunner)·F안(TestModeERunner)이 검증한 것과 정확히 동일한 개인화
 *  반응 계산 로직 — /api/mission/reaction-lean을 2200ms 안에 첫 조각을 못 받으면
 *  buildContentEchoReaction()(아이가 실제로 한 말을 인용하는 폴백)으로 대체한다.
 *  이 함수를 수정하면 D/F/실서비스 세 경로가 전부 영향을 받으니, 세 경로 모두에서
 *  다시 검증하지 않는 한 이 함수의 동작을 바꾸지 마라. */
export async function fetchPersonalizedReaction(
  params: FetchPersonalizedReactionParams
): Promise<string> {
  const { questionText, answerText, sessionId, childTurnId, lastReaction, isStale, onFirstToken, onChunk, timeoutMs = 2200 } = params;
  const fallbackResult = buildContentEchoReaction(answerText, lastReaction);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMarker = Symbol("timeout");

  try {
    const reactionAbortController = params.abortController ?? new AbortController();
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timeoutId = setTimeout(() => resolve(timeoutMarker), timeoutMs);
    });

    const fetchAndFirstChunk = (async () => {
      const res = await fetch("/api/mission/reaction-lean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: reactionAbortController.signal,
        body: JSON.stringify({ questionText, answerText, sessionId, childTurnId }),
      });
      if (!res.ok || !res.body) throw new Error("Reaction fetch failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const first = await reader.read();
      return { reader, decoder, first };
    })();
    fetchAndFirstChunk.catch(() => {});

    const raceResult = await Promise.race([fetchAndFirstChunk, timeoutPromise]);
    clearTimeout(timeoutId);

    if (raceResult === timeoutMarker) {
      reactionAbortController.abort();
      return fallbackResult;
    }

    const { reader, decoder, first } = raceResult;
    try {
      if (isStale()) {
        await reader.cancel().catch(() => {});
        return "";
      }

      let accumulated = "";
      const { done: firstDone, value: firstValue } = first;
      if (!firstDone && firstValue) {
        onFirstToken?.();
        accumulated += decoder.decode(firstValue, { stream: true });
        onChunk?.(accumulated);
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isStale()) {
          await reader.cancel().catch(() => {});
          return "";
        }
        accumulated += decoder.decode(value, { stream: true });
        onChunk?.(accumulated);
      }

      const trimmed = accumulated.trim();
      return trimmed || fallbackResult;
    } finally {
      reader.releaseLock();
    }
  } catch {
    return fallbackResult;
  }
}
