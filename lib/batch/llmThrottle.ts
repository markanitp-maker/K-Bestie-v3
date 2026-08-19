// 요청서 020 §3-11 — Batch LLM 호출 사이 throttle/jitter.
//
// [왜 필요한가]
// 배치 워커는 큐에서 잡을 꺼내 순차로 처리한다. 잡 하나가 빨리 끝나면 다음 Vertex 호출이
// 곧바로 이어져, 여러 워커가 겹칠 때 같은 순간에 요청이 몰린다. 잡 사이에 짧은 간격을
// 두면 같은 총량이라도 시간축으로 흩어진다.
//
// [왜 공통 helper 인가]
// 요청서가 "고정 500ms 를 모든 코드에 복붙하지 않는다" 고 못 박았다. 값이 여러 곳에
// 흩어지면 나중에 조정할 때 한 곳을 빠뜨리고, 그러면 조정한 줄 알았는데 안 된 상태가 된다.
//
// [상한]
// 요청서 §3-11: throttle 때문에 전체 배치가 부모 리포트 알림 시각을 넘기면 안 된다.
// 잡당 최대 500ms 이므로 10잡 사이클에서 최대 5초가 늘어난다 — 알림 시각(07:00 KST)까지
// 여유가 크므로 안전하다. 워커는 10분마다 다시 돌기 때문에 한 사이클이 조금 길어져도
// 다음 사이클이 남은 일을 이어받는다.

/** 잡 사이 지연의 하한/상한(ms). 요청서 §3-11 이 지정한 300~500ms 대역. */
export const BATCH_LLM_THROTTLE_MIN_MS = 300;
export const BATCH_LLM_THROTTLE_MAX_MS = 500;

/**
 * 다음 잡을 시작하기 전에 기다릴 시간(ms)을 고른다.
 *
 * 고정값이 아니라 대역 안에서 흩는 이유: 워커 여러 개가 같은 고정값을 쓰면 처음에
 * 어긋나 있어도 시간이 지나면서 다시 같은 리듬으로 겹칠 수 있다. 잡마다 다르게 두면
 * 그 재동기화가 일어나지 않는다.
 *
 * @param random 0 이상 1 미만 난수 생성기. 테스트에서 고정값을 넣기 위해 주입받는다.
 */
export function pickBatchLlmThrottleMs(random: () => number = Math.random): number {
  const span = BATCH_LLM_THROTTLE_MAX_MS - BATCH_LLM_THROTTLE_MIN_MS;
  const offset = Math.floor(Math.max(0, Math.min(0.999999, random())) * (span + 1));
  return BATCH_LLM_THROTTLE_MIN_MS + offset;
}

/**
 * 잡 사이 간격을 둔다. **첫 잡 앞에서는 부르지 마라** — 워커가 시작하자마자
 * 아무 일도 안 하고 기다리는 것은 지연만 늘린다. 잡을 하나 끝낸 뒤에만 부른다.
 */
export async function throttleBetweenBatchLlmJobs(
  random: () => number = Math.random,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
  const delayMs = pickBatchLlmThrottleMs(random);
  await sleep(delayMs);
  return delayMs;
}
