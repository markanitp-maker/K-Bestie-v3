import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BATCH_LLM_THROTTLE_MAX_MS,
  BATCH_LLM_THROTTLE_MIN_MS,
  pickBatchLlmThrottleMs,
  throttleBetweenBatchLlmJobs,
} from "./llmThrottle";

test("020 §3-11: 지연은 항상 300~500ms 대역 안이다", () => {
  for (const value of [0, 0.25, 0.5, 0.75, 0.999999, 1]) {
    const ms = pickBatchLlmThrottleMs(() => value);
    assert.ok(
      ms >= BATCH_LLM_THROTTLE_MIN_MS && ms <= BATCH_LLM_THROTTLE_MAX_MS,
      `대역을 벗어났다: ${ms}`
    );
  }
});

test("020 §3-11: 고정값이 아니라 난수에 따라 흩어진다", () => {
  // 여러 워커가 같은 고정값을 쓰면 시간이 지나며 다시 같은 리듬으로 겹친다.
  assert.notEqual(pickBatchLlmThrottleMs(() => 0), pickBatchLlmThrottleMs(() => 0.99));
});

test("020 §3-11: 실제로 기다린 시간을 돌려준다", async () => {
  const slept: number[] = [];
  const delay = await throttleBetweenBatchLlmJobs(
    () => 0.5,
    async (ms) => { slept.push(ms); }
  );
  assert.equal(slept.length, 1);
  assert.equal(slept[0], delay);
  assert.ok(delay >= BATCH_LLM_THROTTLE_MIN_MS && delay <= BATCH_LLM_THROTTLE_MAX_MS);
});
