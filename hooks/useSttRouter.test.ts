import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SttRouterController,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SttFailureReason,
  type SttRouterMetrics,
  type SttRouterMeta,
  type SttRouterState,
} from "./useSttRouter.js";

const PCM_CHUNK = new Uint8Array([1, 2, 3, 4]);

class FakeRecognition implements SpeechRecognitionLike {
  public continuous = false;
  public interimResults = false;
  public lang = "";
  public onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  public onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  public onend: (() => void) | null = null;
  public startCalls = 0;
  public stopCalls = 0;
  public abortCalls = 0;
  public throwOnStart = false;

  public start(): void {
    this.startCalls += 1;
    if (this.throwOnStart) throw new Error("recognizer start failed");
  }

  public stop(): void {
    this.stopCalls += 1;
  }

  public abort(): void {
    this.abortCalls += 1;
  }

  public emitFinal(transcript: string, confidence = 0.9): void {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript, confidence } }],
    });
  }

  public emitError(error = "network"): void {
    this.onerror?.({ error });
  }

  public emitEnd(): void {
    this.onend?.();
  }
}

interface HarnessOptions {
  browserSupported?: boolean;
  browserPrimaryEnabled?: boolean;
  gcpFallbackEnabled?: boolean;
  gcpResult?: { text: string; confidence?: number; failureReason?: "network" | "http_error" | "aborted" };
  recognition?: FakeRecognition;
  callGcp?: () => Promise<{ text: string; confidence?: number; failureReason?: "network" | "http_error" | "aborted" }>;
  setTimer?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const flushAsync = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const createHarness = (harnessOptions: HarnessOptions = {}) => {
  const recognition = harnessOptions.recognition ?? new FakeRecognition();
  const finals: Array<{ transcript: string; meta: SttRouterMeta }> = [];
  const failures: SttFailureReason[] = [];
  const metrics: SttRouterMetrics[] = [];
  const states: SttRouterState[] = [];
  const gcpAudio: string[] = [];
  let gcpCalls = 0;

  const controller = new SttRouterController({
    sessionId: "session-1",
    childTurnId: "turn-1",
    browserPrimaryEnabled: harnessOptions.browserPrimaryEnabled ?? true,
    gcpFallbackEnabled: harnessOptions.gcpFallbackEnabled ?? true,
    isBrowserSupported: () => harnessOptions.browserSupported ?? true,
    createRecognition: () => recognition,
    callGcp: async (audioBase64) => {
      gcpCalls += 1;
      gcpAudio.push(audioBase64);
      if (harnessOptions.callGcp) return harnessOptions.callGcp();
      return harnessOptions.gcpResult ?? { text: "GCP 전사" };
    },
    setTimer: harnessOptions.setTimer,
    clearTimer: harnessOptions.clearTimer,
    onFinalTranscript: (transcript, meta) => finals.push({ transcript, meta }),
    onFailure: (reason) => failures.push(reason),
    emitMetrics: (entry) => metrics.push(entry),
    onStateChange: (nextState) => states.push(nextState),
  });

  return {
    controller,
    recognition,
    finals,
    failures,
    metrics,
    states,
    gcpAudio,
    getGcpCalls: () => gcpCalls,
  };
};

const startAndBuffer = (controller: SttRouterController): void => {
  controller.startTurn();
  controller.appendPcm(PCM_CHUNK);
};

test("Browser success는 GCP를 호출하지 않고 final transcript를 한 번만 전달한다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitFinal("브라우저 전사");
  harness.controller.endTurn();

  assert.equal(harness.getGcpCalls(), 0);
  assert.deepEqual(harness.finals.map((entry) => entry.transcript), ["브라우저 전사"]);
  assert.equal(harness.finals[0]?.meta.provider, "browser");
  assert.equal(harness.controller.state, "COMPLETED");
  assert.equal(harness.controller.bufferedByteLength, 0);
});

test("Browser error는 같은 PCM으로 GCP를 정확히 한 번 호출한다", async () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitError("audio-capture");
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.deepEqual(
    Array.from(Uint8Array.from(atob(harness.gcpAudio[0] ?? ""), (character) => character.charCodeAt(0))),
    Array.from(PCM_CHUNK),
  );
  assert.equal(harness.finals.length, 1);
  assert.equal(harness.finals[0]?.meta.provider, "gcp");
  assert.equal(harness.controller.bufferedByteLength, 0);
});

test("Browser empty final은 GCP fallback을 한 번 호출한다", async () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitFinal("   ");
  harness.controller.endTurn();
  harness.recognition.emitEnd();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals.length, 1);
  assert.equal(harness.metrics[0]?.browser_stt_empty, true);
});

test("Browser final timeout은 GCP fallback을 한 번 호출한다", async () => {
  let timeoutCallback: (() => void) | null = null;
  const timer = setTimeout(() => {}, 60000);
  const harness = createHarness({
    setTimer: (callback) => {
      timeoutCallback = callback;
      return timer;
    },
    clearTimer: () => clearTimeout(timer),
  });
  startAndBuffer(harness.controller);
  harness.controller.endTurn();
  assert.ok(timeoutCallback);
  (timeoutCallback as () => void)();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.metrics[0]?.browser_stt_timeout, true);
});

test("SpeechRecognition 미지원은 GCP fallback을 한 번 호출한다", async () => {
  const harness = createHarness({ browserSupported: false });
  startAndBuffer(harness.controller);
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals[0]?.meta.browserSupported, false);
});

test("recognizer start 실패는 GCP fallback 조건이다", async () => {
  const startFailureRecognition = new FakeRecognition();
  startFailureRecognition.throwOnStart = true;
  const startFailure = createHarness({ recognition: startFailureRecognition });
  startAndBuffer(startFailure.controller);
  startFailure.controller.endTurn();
  await flushAsync();

  assert.equal(startFailure.getGcpCalls(), 1);
});

test("BROWSER_PROCESSING 진입 후 pending 없이 onend가 오면 GCP fallback 조건이다", async () => {
  // LISTENING 중의 조용한 onend는(위 재시작 테스트 참고) 실패가 아니다 — endTurn()이
  // 이미 호출돼 recognition.stop()을 요청한 뒤에도 아무 final도 못 받고 onend가
  // 오는 경우만 진짜 실패로 취급해 GCP로 넘어가야 한다.
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.controller.endTurn();
  harness.recognition.emitEnd();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
});

test("Browser success 뒤 late error가 와도 GCP 호출은 0회다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  const lateError = harness.recognition.onerror;
  harness.recognition.emitFinal("성공 전사");
  harness.controller.endTurn();
  lateError?.({ error: "network" });

  assert.equal(harness.getGcpCalls(), 0);
  assert.equal(harness.finals.length, 1);
});

test("GCP fallback이 시작된 뒤 late Browser result는 폐기되어 final이 하나다", async () => {
  let resolveGcp: ((result: { text: string }) => void) | null = null;
  const gcpPromise = new Promise<{ text: string }>((resolve) => {
    resolveGcp = resolve;
  });
  const harness = createHarness({ callGcp: () => gcpPromise });
  startAndBuffer(harness.controller);
  const lateResult = harness.recognition.onresult;
  harness.recognition.emitError();
  harness.controller.endTurn();
  lateResult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "늦은 브라우저 전사" } }],
  });
  assert.ok(resolveGcp);
  (resolveGcp as (result: { text: string }) => void)({ text: "GCP 승자" });
  await flushAsync();

  assert.deepEqual(harness.finals.map((entry) => entry.transcript), ["GCP 승자"]);
  assert.equal(harness.getGcpCalls(), 1);
});

test("GCP success는 downstream을 한 번만 호출하고 duplicate end submit을 무시한다", async () => {
  const harness = createHarness({ browserSupported: false });
  startAndBuffer(harness.controller);
  harness.controller.endTurn();
  harness.controller.endTurn();
  await flushAsync();
  harness.controller.endTurn();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals.length, 1);
});

test("한 발화 안에서 여러 final 세그먼트가 오면 앞부분을 잃지 않고 누적된다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  // continuous=true 하에서 Chrome/Edge는 한 발화 중 짧은 휴지마다 별도 final을
  // 내보내고, resultIndex부터의 새 세그먼트만 담는다 — 두 번째 final이 첫 번째를
  // 덮어쓰면 안 된다.
  // results는 SpeechRecognition의 실제 계약대로 세션 누적 리스트다 — 두 번째
  // 이벤트는 index 0(이미 처리됨)을 그대로 유지한 채 resultIndex=1에서
  // 새 세그먼트만 가리킨다.
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "어제 민서랑 놀았는데" } }],
  });
  harness.recognition.onresult?.({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "어제 민서랑 놀았는데" } },
      { isFinal: true, 0: { transcript: "진짜 재밌었어" } },
    ],
  });
  harness.controller.endTurn();

  assert.equal(harness.getGcpCalls(), 0);
  assert.deepEqual(
    harness.finals.map((entry) => entry.transcript),
    ["어제 민서랑 놀았는데 진짜 재밌었어"],
  );
});

test("같은 index를 재전달하는 엔진에서 누적이 중복되지 않는다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  // iOS Safari 계열 엔진은 새 세그먼트만이 아니라 누적 결과 전체를 매번
  // resultIndex 0부터 다시 보낸다 — 같은 index를 문자열로 이어붙이면 중복된다.
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "안녕하세요" } }],
  });
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "안녕하세요" } }],
  });
  harness.controller.endTurn();

  assert.deepEqual(harness.finals.map((entry) => entry.transcript), ["안녕하세요"]);
});

test("recognizer가 발화 도중 조용히 끝나면(Android Chrome) 재시작해 뒷부분을 잃지 않는다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "첫 번째 세그먼트" } }],
  });
  assert.equal(harness.recognition.startCalls, 1);

  // 에러 없이 onend만 발생 — 아직 endTurn()은 호출되지 않은 상태(state===LISTENING).
  // 죽은 recognizer를 방치하지 않고 재시작해야 한다.
  harness.recognition.emitEnd();
  assert.equal(harness.recognition.startCalls, 2, "clean mid-turn onend must restart the recognizer");

  harness.recognition.onresult?.({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "첫 번째 세그먼트" } },
      { isFinal: true, 0: { transcript: "두 번째 세그먼트" } },
    ],
  });
  harness.controller.endTurn();

  assert.equal(harness.getGcpCalls(), 0);
  assert.deepEqual(
    harness.finals.map((entry) => entry.transcript),
    ["첫 번째 세그먼트 두 번째 세그먼트"],
  );
});

test("Browser와 GCP가 모두 실패하면 FAILED 후 새 turn을 시작할 수 있다", async () => {
  const harness = createHarness({ gcpResult: { text: "", failureReason: "network" } });
  startAndBuffer(harness.controller);
  harness.recognition.emitError();
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.controller.state, "FAILED");
  assert.deepEqual(harness.failures, ["browser_and_gcp_failed"]);
  assert.equal(harness.controller.bufferedByteLength, 0);

  harness.controller.startTurn();
  assert.equal(harness.controller.state, "LISTENING");
});

test("Browser primary가 비활성이고 env가 미설정된 경로는 기존 GCP-only로 동작한다", async () => {
  const harness = createHarness({
    browserPrimaryEnabled: false,
    gcpFallbackEnabled: false,
  });
  startAndBuffer(harness.controller);
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.recognition.startCalls, 0);
  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals[0]?.meta.fallbackTriggered, false);
});

test("cancel은 PCM과 recognizer를 정리하고 downstream을 호출하지 않는다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  assert.equal(harness.controller.bufferedByteLength, PCM_CHUNK.byteLength);
  harness.controller.cancel();

  assert.equal(harness.controller.state, "CANCELLED");
  assert.equal(harness.controller.bufferedByteLength, 0);
  assert.equal(harness.recognition.abortCalls, 1);
  assert.equal(harness.finals.length, 0);
});

test("unmount cleanup에 해당하는 dispose는 PCM을 폐기하고 late event를 차단한다", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  const lateResult = harness.recognition.onresult;
  harness.controller.dispose();
  lateResult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "해제 뒤 결과" } }],
  });

  assert.equal(harness.controller.state, "CANCELLED");
  assert.equal(harness.controller.bufferedByteLength, 0);
  assert.equal(harness.finals.length, 0);
});
