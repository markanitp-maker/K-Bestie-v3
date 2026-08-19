// 요청서 020 §3-12 — Batch 재시도 분류.
//
// [실시간과 정책이 다르다]
// 실시간 미션은 아이가 기다리므로 429 에서 즉시 포기하고 결정론 응답으로 넘어간다.
// 배치는 즉시 응답할 필요가 없으므로 **다음 worker cycle 로 넘긴다**(워커가 10분마다
// 다시 돈다). 같은 모델을 즉시 반복 호출해 Burst 를 키우지 않는다 — 요청서가 그걸 금지했다.
// 그래서 이 파일은 "무엇을 재시도 가능으로 볼 것인가" 만 정한다. 재시도 자체는
// 큐가 담당한다(fail_*_job_v3 RPC 의 p_retryable).
//
// [왜 공통 모듈인가]
// 세 워커(memory / contextCorrection / dailyReport)가 각자 문자열 검사를 들고 있었고
// 서로 목록이 달랐다. memoryV3 에는 `errMsg.includes("50")` 이 있었는데, 이건 "50" 이
// 들어간 **아무 메시지나** 재시도 대상으로 만든다(예: "50 messages processed",
// id 에 50 이 들어간 경우). 영구 실패가 무한히 재큐잉되는 통로였다.
// 전송 계층 오류 판정은 한 곳에서만 정의한다.

/** HTTP/네트워크 계층의 일시적 오류인가. 도메인 오류는 각 워커가 따로 판단한다. */
export function isRetryableTransportError(message: string): boolean {
  const msg = message ?? "";
  const lower = msg.toLowerCase();

  // 상태 코드는 **단어 경계로** 본다. 부분 문자열 매칭이 위 사고의 원인이었다.
  if (/\b(?:429|500|502|503|504)\b/.test(msg)) return true;
  if (/RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(msg)) return true;

  return (
    lower.includes("fetch failed")
    || lower.includes("timeout")
    || lower.includes("etimedout")
    || lower.includes("econnreset")
    || lower.includes("socket hang up")
    || lower.includes("network")
    || lower.includes("connection")
  );
}
