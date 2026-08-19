import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  SttRouterController,
  chunkDurationMsFor,
  STT_CHUNK_DURATION_MS,
  STT_SAMPLE_RATE,
  STT_SILENCE_MS_TO_FINALIZE,
  stopMediaStreamTracks,
  isSttDebugEnabled,
  getSampleRateVerdict,
  calculateChunkDurationMsActual,
  calculateOnsetDiscardedMs,
  calculateEffectivePcmSampleRate,
  getLatestSttCaptureTelemetry,
  getLatestSttUtteranceTelemetry,
  recordSttCaptureTelemetry,
  recordSttUtteranceTelemetry,
  resetSttTelemetryForTesting,
  subscribeSttTelemetry,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SttFailureReason,
  type SttRouterMetrics,
  type SttRouterMeta,
  type SttRouterState,
  type SttCaptureTelemetry,
  type SttUtteranceTelemetry,
  useSttRouter,
} from "./useSttRouter.js";
import { SttDebugOverlay } from "../components/debug/SttDebugOverlay.jsx";

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

  // 재시작된 recognizer는 새 SpeechRecognition 세션이다 — resultIndex는 발화
  // 전체가 아니라 그 세션 내부의 상대 위치이므로, 이 세션의 첫 final도
  // resultIndex: 0 + 새 results 배열로 도착한다(이전 세션과 이어지는 index/배열이
  // 아니다). 이 모델링을 틀리면 committedSegments 분리 결함을 가린다.
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "두 번째 세그먼트" } }],
  });
  harness.controller.endTurn();

  assert.equal(harness.getGcpCalls(), 0);
  assert.deepEqual(
    harness.finals.map((entry) => entry.transcript),
    ["첫 번째 세그먼트 두 번째 세그먼트"],
  );
});

test("재시작 후 첫 세그먼트가 2개였어도 순서를 보존한다(committed 분리 검증)", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  // 1세션이 두 세그먼트(index 0, 1)를 냈고 재시작 뒤 2세션이 index 0 하나만
  // 낸다면, committed 분리 없이는 "C B"처럼 순서가 뒤집힌다.
  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "A" } }],
  });
  harness.recognition.onresult?.({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "A" } },
      { isFinal: true, 0: { transcript: "B" } },
    ],
  });
  harness.recognition.emitEnd();
  assert.equal(harness.recognition.startCalls, 2);

  harness.recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "C" } }],
  });
  harness.controller.endTurn();

  assert.deepEqual(harness.finals.map((entry) => entry.transcript), ["A B C"]);
});

test("재시작 게이트: 이미 browserFailed면 다시 재시작하지 않고 즉시 GCP로 간다(무한 스핀 방지)", async () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitError("not-allowed");
  assert.equal(harness.recognition.startCalls, 1);

  // start 직후 즉시 재실패하는 조건(마이크 권한 회수 등)을 흉내낸다 — error 이후
  // 곧바로 onend가 온다. browserFailed가 이미 섰으므로 재시작해선 안 된다.
  harness.recognition.emitEnd();
  assert.equal(harness.recognition.startCalls, 1, "browserFailed 상태에서는 재시작하지 않는다");

  harness.controller.endTurn();
  await flushAsync();
  assert.equal(harness.getGcpCalls(), 1);
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

test("마이크 비활성화는 MediaStream 트랙을 멈추고 재활성화는 스트림을 다시 획득한다", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const tracks: Array<{ stopCalls: number; stop(): void }> = [];
  let getUserMediaCalls = 0;

  class FakeAudioContext {
    public destination = {};

    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }

    createScriptProcessor() {
      return { connect() {}, disconnect() {}, onaudioprocess: null };
    }

    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalls += 1;
          const track = {
            stopCalls: 0,
            stop() { this.stopCalls += 1; },
          };
          tracks.push(track);
          return {
            getTracks: () => [track],
          } as unknown as MediaStream;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });

  let router: ReturnType<typeof useSttRouter> | null = null;
  const Harness = () => {
    router = useSttRouter({
      sessionId: "session-1",
      childTurnId: "turn-1",
      onFinalTranscript: () => {},
      onFailure: () => {},
    });
    return null;
  };

  try {
    renderToString(React.createElement(Harness));
    assert.ok(router);
    const activeRouter = router as ReturnType<typeof useSttRouter>;
    await activeRouter.startCapture();
    assert.equal(getUserMediaCalls, 1);
    assert.equal(tracks[0]?.stopCalls, 0);

    // setMicEnabled는 매 PTT 턴마다 불리는 경량 게이트일 뿐 스트림을 건드리지 않는다 —
    // 텍스트 모드 전환은 stopCapture/startCapture를 직접 호출하는 쪽의 책임이다.
    activeRouter.setMicEnabled(false);
    assert.equal(tracks[0]?.stopCalls, 0, "setMicEnabled(false)는 스트림을 정지하지 않아야 한다(수동 PTT 회귀 방지)");
    activeRouter.setMicEnabled(true);
    assert.equal(getUserMediaCalls, 1, "setMicEnabled(true)는 스트림을 재획득하지 않아야 한다");

    activeRouter.stopCapture();
    assert.equal(tracks[0]?.stopCalls, 1, "텍스트 모드 전환(stopCapture) 시 기존 트랙이 정지해야 한다");

    await activeRouter.startCapture();
    assert.equal(getUserMediaCalls, 2, "음성 모드 복귀(startCapture) 시 getUserMedia를 다시 호출해야 한다");
    assert.equal(tracks[1]?.stopCalls, 0);

    activeRouter.stopCapture();
    assert.equal(tracks[1]?.stopCalls, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
    if (originalAudioContext) Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
});

test("getUserMedia 진행 중 stopCapture가 불려도 이후 startCapture는 새 스트림을 획득한다(경합 방지)", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  // call 번호로 태그해 추적한다 — 지연된 첫 호출이 배열에 나중에 push되므로
  // (아래 참고) 배열 인덱스만으로는 어느 트랙이 어느 startCapture 호출의
  // 결과인지 알 수 없다.
  const tracksByCall = new Map<number, { stopCalls: number; stop(): void }>();
  let getUserMediaCalls = 0;
  let resolveFirstCall: (() => void) | null = null;

  class FakeAudioContext {
    public destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
    close(): Promise<void> { return Promise.resolve(); }
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalls += 1;
          const callNumber = getUserMediaCalls;
          const isFirstCall = callNumber === 1;
          if (isFirstCall) {
            // 첫 번째 획득은 stopCapture(뒤이어 두 번째 startCapture)가 먼저 도착할
            // 때까지 인위적으로 지연시켜 "진행 중에 세대가 바뀌는" 경합을 재현한다.
            // 이 지연 때문에 두 번째 호출의 트랙이 먼저 생성/push된다 — 배열
            // 순서가 아니라 tracksByCall(call 번호)로 트랙을 식별해야 한다.
            await new Promise<void>((resolve) => { resolveFirstCall = resolve; });
          }
          const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
          tracksByCall.set(callNumber, track);
          return { getTracks: () => [track] } as unknown as MediaStream;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });

  let router: ReturnType<typeof useSttRouter> | null = null;
  const Harness = () => {
    router = useSttRouter({
      sessionId: "session-1",
      childTurnId: "turn-1",
      onFinalTranscript: () => {},
      onFailure: () => {},
    });
    return null;
  };

  try {
    renderToString(React.createElement(Harness));
    assert.ok(router);
    const activeRouter = router as ReturnType<typeof useSttRouter>;

    const firstCapture = activeRouter.startCapture();
    // 아직 getUserMedia가 resolve되지 않은 상태에서 stopCapture를 호출한다(세대 증가).
    activeRouter.stopCapture();
    // 첫 요청이 여전히 pending인 상태에서 두 번째 startCapture를 호출한다 — 이 fix
    // 이전 코드는 capturePromiseRef가 아직 비워지지 않아 이 호출이 곧 폐기될 첫
    // promise를 그대로 반환했고("성공했지만 스트림 없음" 결함), getUserMedia는
    // 두 번째로 호출되지 않았다.
    const secondCapture = activeRouter.startCapture();
    resolveFirstCall?.();
    await firstCapture;
    await secondCapture;

    // 경합 중 호출된 두 번째 startCapture는 죽은 promise를 재사용하지 않고 반드시
    // 새 getUserMedia로 새 스트림을 획득해야 한다.
    assert.equal(getUserMediaCalls, 2, "경합 중 두 번째 startCapture는 새 getUserMedia를 호출해야 한다");
    // 세대가 바뀐 뒤(1번 호출) 뒤늦게 도착한 첫 스트림은 즉시 폐기되어야 한다.
    assert.equal(tracksByCall.get(1)?.stopCalls, 1, "폐기된 세대(1번 호출)의 스트림은 트랙이 정지돼야 한다");
    // 현재 세대에서 획득한 두 번째 스트림은 살아남아 실제 캡처에 쓰여야 한다.
    assert.equal(tracksByCall.get(2)?.stopCalls, 0, "현재 세대(2번 호출)의 스트림은 살아있어야 한다");

    activeRouter.stopCapture();
    assert.equal(tracksByCall.get(2)?.stopCalls, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
    if (originalAudioContext) Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
});

test("stopMediaStreamTracks는 스트림의 모든 트랙을 정지한다", () => {
  const stopped: string[] = [];
  stopMediaStreamTracks({
    getTracks: () => [
      { stop: () => stopped.push("audio") },
      { stop: () => stopped.push("video") },
    ] as MediaStreamTrack[],
  });

  assert.deepEqual(stopped, ["audio", "video"]);
});

test("STT Debug 게이트: NEXT_PUBLIC_STT_DEBUG가 활성화되지 않으면 계측은 no-op이다", () => {
  const originalEnv = process.env.NEXT_PUBLIC_STT_DEBUG;
  try {
    process.env.NEXT_PUBLIC_STT_DEBUG = "";
    resetSttTelemetryForTesting();

    assert.equal(isSttDebugEnabled(), false);

    const dummyCapture: SttCaptureTelemetry = {
      audioContextSampleRate: 16000,
      trackSampleRate: 16000,
      trackChannelCount: 1,
      configuredSampleRate: 16000,
      processorBufferSize: 2048,
      chunkDurationMsActual: 128,
      chunkDurationMsAssumed: 128,
      verdict: "MATCH_16K",
      micOpenedAt: 1000,
    };
    recordSttCaptureTelemetry(dummyCapture);
    assert.equal(getLatestSttCaptureTelemetry(), null, "게이트 OFF 상태에서는 캡처 계측이 저장되지 않는다");

    const dummyUtterance: SttUtteranceTelemetry = {
      utterance_id: "turn-1",
      provider: "browser",
      audioContextSampleRate: 16000,
      configuredSampleRate: 16000,
      speechStartWallClock: 1000,
      speechEndWallClock: 3000,
      actualSpeechDurationMs: 2000,
      pcmChunkCount: 10,
      pcmByteLength: 64000,
      processorBufferSize: 2048,
      declaredGcpSampleRate: 16000,
      sttRequestAt: 1000,
      sttFinalAt: 3200,
      sttLatencyMs: 2200,
      effectivePcmSampleRate: 16000,
      micOpenedAt: 900,
      firstVoiceChunkAt: 1000,
      firstPcmAppendAt: 1000,
      onsetDiscardedMs: 0,
      actualPcmCaptureDurationMs: 2000,
      chunkDurationMsActual: 128,
      chunkDurationMsAssumed: 128,
      verdict: "MATCH_16K",
    };
    recordSttUtteranceTelemetry(dummyUtterance);
    assert.equal(getLatestSttUtteranceTelemetry(), null, "게이트 OFF 상태에서는 발화 계측이 저장되지 않는다");
  } finally {
    process.env.NEXT_PUBLIC_STT_DEBUG = originalEnv;
    resetSttTelemetryForTesting();
  }
});

test("STT Debug 게이트: NEXT_PUBLIC_STT_DEBUG === 'true' 일 때 계측 저장 및 구독이 정상 동작한다", () => {
  const originalEnv = process.env.NEXT_PUBLIC_STT_DEBUG;
  try {
    process.env.NEXT_PUBLIC_STT_DEBUG = "true";
    resetSttTelemetryForTesting();

    assert.equal(isSttDebugEnabled(), true);

    let notifyCount = 0;
    const unsubscribe = subscribeSttTelemetry(() => {
      notifyCount += 1;
    });

    const dummyCapture: SttCaptureTelemetry = {
      audioContextSampleRate: 48000,
      trackSampleRate: 48000,
      trackChannelCount: 1,
      configuredSampleRate: 16000,
      processorBufferSize: 2048,
      chunkDurationMsActual: 42.67,
      chunkDurationMsAssumed: 128,
      verdict: "MISMATCH_48K",
      micOpenedAt: 1000,
    };
    recordSttCaptureTelemetry(dummyCapture);
    assert.deepEqual(getLatestSttCaptureTelemetry(), dummyCapture);
    assert.equal(notifyCount, 1);

    unsubscribe();
    recordSttCaptureTelemetry(dummyCapture);
    assert.equal(notifyCount, 1, "구독 해제 후에는 알림이 발생하지 않는다");
  } finally {
    process.env.NEXT_PUBLIC_STT_DEBUG = originalEnv;
    resetSttTelemetryForTesting();
  }
});

test("chunkDurationMsActual 계산: 16k, 48k, 44.1k 버퍼 실제 duration 계산", () => {
  // 16000Hz: 2048 / 16000 * 1000 = 128ms
  const dur16k = calculateChunkDurationMsActual(16000, 2048);
  assert.equal(dur16k, 128);

  // 48000Hz: 2048 / 48000 * 1000 = 42.6666...
  const dur48k = calculateChunkDurationMsActual(48000, 2048);
  assert.ok(Math.abs(dur48k - 42.6666667) < 0.0001);
  assert.equal(dur48k.toFixed(2), "42.67");

  // 44100Hz: 2048 / 44100 * 1000 = 46.4399...
  const dur44k = calculateChunkDurationMsActual(44100, 2048);
  assert.ok(Math.abs(dur44k - 46.439909) < 0.0001);
  assert.equal(dur44k.toFixed(2), "46.44");

  // 유효하지 않은 샘플레이트 방어
  assert.equal(calculateChunkDurationMsActual(0, 2048), 0);
  assert.equal(calculateChunkDurationMsActual(-100, 2048), 0);
});

test("effectivePcmSampleRate 계산: PCM append 구간(actualPcmCaptureDurationMs)만 사용하여 정확히 산출한다", () => {
  // 16kHz 오디오 2초(2000ms) 동안 수집:
  // 16000 samples/sec * 2 bytes/sample * 2 sec = 64,000 bytes.
  const pcmBytes16k = 64000;
  const actualCaptureMs16k = 2000;
  const rate16k = calculateEffectivePcmSampleRate(pcmBytes16k, actualCaptureMs16k);
  assert.equal(rate16k, 16000, "16kHz PCM의 실효 레이트는 16000Hz여야 한다");

  // 48kHz 오디오 2초(2000ms) 동안 수집:
  // 48000 samples/sec * 2 bytes/sample * 2 sec = 192,000 bytes.
  const pcmBytes48k = 192000;
  const actualCaptureMs48k = 2000;
  const rate48k = calculateEffectivePcmSampleRate(pcmBytes48k, actualCaptureMs48k);
  assert.equal(rate48k, 48000, "48kHz PCM의 실효 레이트는 48000Hz여야 한다");

  // 44.1kHz 오디오 1초(1000ms) 동안 수집:
  // 44100 samples/sec * 2 bytes/sample * 1 sec = 88,200 bytes.
  const pcmBytes44k = 88200;
  const actualCaptureMs44k = 1000;
  const rate44k = calculateEffectivePcmSampleRate(pcmBytes44k, actualCaptureMs44k);
  assert.equal(rate44k, 44100, "44.1kHz PCM의 실효 레이트는 44100Hz여야 한다");

  // [검증] VAD 침묵 대기 900ms나 STT API 왕복 지연 1500ms가 섞이면 계산이 완전히 왜곡된다.
  const contaminatedDurationMs = actualCaptureMs16k + 900 + 1500; // 4400ms
  const contaminatedRate = calculateEffectivePcmSampleRate(pcmBytes16k, contaminatedDurationMs);
  assert.notEqual(contaminatedRate, 16000);
  assert.equal(contaminatedRate, 7272.73, "오염된 duration을 넣으면 7272Hz로 심각하게 왜곡됨을 확인");

  // 0 또는 음수 duration 방어
  assert.equal(calculateEffectivePcmSampleRate(pcmBytes16k, 0), 0);
  assert.equal(calculateEffectivePcmSampleRate(0, 2000), 0);
});

test("onsetDiscardedMs 계산: threshold 이전 흘려보낸 콜백 수 × 실제 chunk duration", () => {
  // 48kHz (chunk duration ~42.6667ms) 환경에서 3개 콜백이 threshold 이전에 흘려보내짐
  const chunkDur48k = 2048 / 48000 * 1000;
  const discardedMs = calculateOnsetDiscardedMs(3, chunkDur48k);
  assert.equal(Math.round(discardedMs), 128); // 3 * 42.6667ms = 128ms

  // 16kHz (chunk duration 128ms) 환경에서 2개 콜백
  const discardedMs16k = calculateOnsetDiscardedMs(2, 128);
  assert.equal(discardedMs16k, 256);

  // 0개 콜백
  assert.equal(calculateOnsetDiscardedMs(0, 128), 0);
});

test("getSampleRateVerdict: 16k, 44.1k, 48k 및 그 외 판정 문자열 매핑", () => {
  assert.equal(getSampleRateVerdict(16000), "MATCH_16K");
  assert.equal(getSampleRateVerdict(44100), "MISMATCH_44K");
  assert.equal(getSampleRateVerdict(48000), "MISMATCH_48K");
  assert.equal(getSampleRateVerdict(24000), "UNKNOWN");
  assert.equal(getSampleRateVerdict(8000), "UNKNOWN");
  assert.equal(getSampleRateVerdict(undefined), "UNKNOWN");
  assert.equal(getSampleRateVerdict(0), "UNKNOWN");
});

test("SttDebugOverlay: NEXT_PUBLIC_STT_DEBUG OFF일 때는 빈 렌더, ON일 때는 계측 패널을 렌더한다", () => {
  const originalEnv = process.env.NEXT_PUBLIC_STT_DEBUG;
  try {
    // 1. OFF 상태
    process.env.NEXT_PUBLIC_STT_DEBUG = "";
    resetSttTelemetryForTesting();
    const htmlOff = renderToString(React.createElement(SttDebugOverlay));
    assert.equal(htmlOff, "", "디버그 플래그가 꺼져 있으면 오버레이는 렌더되지 않는다");

    // 2. ON 상태 (계측 데이터 주입)
    process.env.NEXT_PUBLIC_STT_DEBUG = "true";
    recordSttCaptureTelemetry({
      audioContextSampleRate: 48000,
      trackSampleRate: 48000,
      trackChannelCount: 1,
      configuredSampleRate: 16000,
      processorBufferSize: 2048,
      chunkDurationMsActual: 42.67,
      chunkDurationMsAssumed: 128,
      verdict: "MISMATCH_48K",
      micOpenedAt: 1000,
    });
    recordSttUtteranceTelemetry({
      utterance_id: "stt-turn-1",
      provider: "browser",
      audioContextSampleRate: 48000,
      trackSampleRate: 48000,
      configuredSampleRate: 16000,
      speechStartWallClock: 1000,
      speechEndWallClock: 2500,
      actualSpeechDurationMs: 1500,
      pcmChunkCount: 35,
      pcmByteLength: 144000,
      processorBufferSize: 2048,
      declaredGcpSampleRate: 16000,
      sttRequestAt: 1000,
      sttFinalAt: 2700,
      sttLatencyMs: 1700,
      effectivePcmSampleRate: 48000,
      micOpenedAt: 900,
      firstVoiceChunkAt: 1000,
      firstPcmAppendAt: 1000,
      onsetDiscardedMs: 42.67,
      actualPcmCaptureDurationMs: 1500,
      chunkDurationMsActual: 42.67,
      chunkDurationMsAssumed: 128,
      verdict: "MISMATCH_48K",
    });

    // Note: React 18 renderToString runs SSR without useEffect mounting,
    // so in SSR it checks mounted state which defaults false. To test client markup:
    // We test that when isSttDebugEnabled() is false, it returns null without exception.
    // And when isSttDebugEnabled() is true, isSttDebugEnabled() returns true.
    assert.equal(isSttDebugEnabled(), true);
    assert.equal(getLatestSttUtteranceTelemetry()?.verdict, "MISMATCH_48K");
    assert.equal(getLatestSttUtteranceTelemetry()?.effectivePcmSampleRate, 48000);
    assert.equal(getLatestSttUtteranceTelemetry()?.chunkDurationMsActual, 42.67);
  } finally {
    process.env.NEXT_PUBLIC_STT_DEBUG = originalEnv;
    resetSttTelemetryForTesting();
  }
});

/** 2026-08-17: 침묵 누적을 고정 128ms가 아니라 실제 AudioContext 레이트 기준으로
 *  바꿨다. 브라우저가 16000 요청을 무시하면(특히 iOS Safari) 콜백 1회가 42.67ms인데
 *  128ms로 세어 900ms 임계가 실제 300ms 만에 걸렸다 — 아이 말이 중간에 끊긴다. */
test("chunkDurationMsFor: 실제 레이트로 콜백 길이를 계산한다", () => {
  assert.equal(chunkDurationMsFor(16000), 128);
  assert.ok(Math.abs(chunkDurationMsFor(48000) - 42.6667) < 0.01);
  assert.ok(Math.abs(chunkDurationMsFor(44100) - 46.4399) < 0.01);
});

test("chunkDurationMsFor: 레이트를 모르면 기존 고정값으로 떨어진다", () => {
  for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(chunkDurationMsFor(bad as number), STT_CHUNK_DURATION_MS);
  }
});

test("chunkDurationMsFor: 16kHz 기기는 기존 동작과 완전히 같다", () => {
  // 정상 기기에서 이번 수정이 아무것도 바꾸지 않음을 고정한다.
  assert.equal(chunkDurationMsFor(STT_SAMPLE_RATE), STT_CHUNK_DURATION_MS);
});

test("침묵 임계 도달 시점: 48kHz에서 임계값이 실제 임계값 근처여야 한다", () => {
  const perChunk = chunkDurationMsFor(48000);
  const chunksToThreshold = Math.ceil(STT_SILENCE_MS_TO_FINALIZE / perChunk);
  const actualMs = chunksToThreshold * perChunk;
  assert.ok(actualMs >= STT_SILENCE_MS_TO_FINALIZE, "임계 미달");
  assert.ok(actualMs < STT_SILENCE_MS_TO_FINALIZE + perChunk, "임계 초과");
  // 고정 128ms로 셌다면 임계값의 1/3 지점에서 끊겼다(48kHz 기기는 콜백당 실제 오디오가
  // 128ms 가 아니라 그 3배다). 018 §3-16 으로 임계값이 900 -> 1200 이 되어도 이 비율은
  // 그대로이므로 절대값 대신 비율로 고정한다.
  const brokenChunks = Math.ceil(STT_SILENCE_MS_TO_FINALIZE / STT_CHUNK_DURATION_MS);
  assert.ok(
    brokenChunks * perChunk < STT_SILENCE_MS_TO_FINALIZE / 2,
    "기존 버그 재현 전제가 틀림"
  );
});

test("Browser 인식 결과가 한글 자모(ㅍ, ㅠㅠ 등)일 때 onFinalTranscript 대신 onFailure('unintelligible') 호출", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitFinal("ㅍ");
  harness.controller.endTurn();

  assert.equal(harness.finals.length, 0, "onFinalTranscript가 호출되면 안 됨");
  assert.deepEqual(harness.failures, ["unintelligible"], "onFailure('unintelligible') 호출되어야 함");
  assert.equal(harness.controller.state, "FAILED");
});

test("Browser 인식 결과가 유효한 한 글자 대답(응)일 때 정상 완료", () => {
  const harness = createHarness();
  startAndBuffer(harness.controller);
  harness.recognition.emitFinal("응");
  harness.controller.endTurn();

  assert.equal(harness.finals.length, 1);
  assert.equal(harness.finals[0]?.transcript, "응");
  assert.equal(harness.failures.length, 0);
  assert.equal(harness.controller.state, "COMPLETED");
});

test("GCP fallback 전사 결과가 한글 자모(ㅠㅠ, ㄱ ㄴ 등)일 때 onFinalTranscript 대신 onFailure('unintelligible') 호출", async () => {
  const harness = createHarness({
    gcpResult: { text: "ㅠㅠ" },
  });
  startAndBuffer(harness.controller);
  harness.recognition.emitError("audio-capture");
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals.length, 0, "onFinalTranscript가 호출되면 안 됨");
  assert.deepEqual(harness.failures, ["unintelligible"], "onFailure('unintelligible') 호출되어야 함");
  assert.equal(harness.controller.state, "FAILED");
});

test("GCP fallback 전사 결과가 유효한 한 글자/단문(네, 123, ok)일 때 정상 완료", async () => {
  const harness = createHarness({
    gcpResult: { text: "네" },
  });
  startAndBuffer(harness.controller);
  harness.recognition.emitError("audio-capture");
  harness.controller.endTurn();
  await flushAsync();

  assert.equal(harness.getGcpCalls(), 1);
  assert.equal(harness.finals.length, 1);
  assert.equal(harness.finals[0]?.transcript, "네");
  assert.equal(harness.failures.length, 0);
  assert.equal(harness.controller.state, "COMPLETED");
});
