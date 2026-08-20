// @ts-nocheck
import assert from "node:assert/strict";
import { after, afterEach, before, mock, test } from "node:test";
import { createRequire } from "node:module";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";

const projectRequire = createRequire(import.meta.url);
const sandboxRequire = createRequire("/tmp/p0-real-repro-jsdom-runtime/package.json");
const { JSDOM } = (() => {
  try {
    return projectRequire("jsdom");
  } catch {
    return sandboxRequire("jsdom");
  }
})();

type ScenarioKind = "new" | "resumed" | "locked";
type VoiceMode = "stt_tts" | "live";

type ScenarioRuntime = ReturnType<typeof createScenarioRuntime>;

let runtime: ScenarioRuntime;
let dom: InstanceType<typeof JSDOM>;
let root: ReturnType<typeof createRoot> | null = null;
let ChildMissionsPage: React.ComponentType;

const createResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const createScenarioRuntime = (kind: ScenarioKind, voiceMode: VoiceMode) => {
  const timeline: Array<Record<string, unknown>> = [];
  let sequence = 0;
  const push = (event: string, detail: Record<string, unknown> = {}) => {
    timeline.push({ sequence: ++sequence, event, ...detail });
  };
  const spy = (name: string, implementation?: (...args: unknown[]) => unknown) => mock.fn((...args: unknown[]) => {
    push(name, { args });
    return implementation?.(...args);
  });

  const scenario = {
    kind,
    voiceMode,
    timeline,
    push,
    latestLayoutProps: null as null | Record<string, unknown>,
    sttStatusSetter: null as null | React.Dispatch<React.SetStateAction<string>>,
    liveStatusSetter: null as null | React.Dispatch<React.SetStateAction<string>>,
    sttOptions: null as null | Record<string, unknown>,
    liveOptions: null as null | Record<string, unknown>,
    stt: {} as Record<string, ReturnType<typeof mock.fn>>,
    live: {} as Record<string, ReturnType<typeof mock.fn>>,
  };

  scenario.stt = {
    setMicEnabled: spy("stt.setMicEnabled"),
    releaseMicrophone: spy("stt.releaseMicrophone"),
    reacquireMicrophone: spy("stt.reacquireMicrophone", async () => {}),
    setInputMode: spy("stt.setInputMode"),
    startSession: spy("stt.startSession", async () => {
      scenario.sttStatusSetter?.("live");
    }),
    stopSession: spy("stt.stopSession"),
    seedTranscript: spy("stt.seedTranscript"),
    getTranscript: spy("stt.getTranscript", () => []),
    sendTypedText: spy("stt.sendTypedText"),
    speak: spy("stt.speak", async () => true),
    sayText: spy("stt.sayText"),
    stopSpeaking: spy("stt.stopSpeaking"),
    manualFinalize: spy("stt.manualFinalize"),
    cancelFinalize: spy("stt.cancelFinalize"),
  };
  scenario.live = {
    setMicEnabled: spy("live.setMicEnabled"),
    setInteractionMode: spy("live.setInteractionMode"),
    setAudioMuted: spy("live.setAudioMuted"),
    startSession: spy("live.startSession", async () => {
      scenario.liveStatusSetter?.("live");
    }),
    stopSession: spy("live.stopSession"),
    seedTranscript: spy("live.seedTranscript"),
    getTranscript: spy("live.getTranscript", () => []),
    sendTypedText: spy("live.sendTypedText", (text: string) => {
      const result = Boolean(scenario.liveOptions?.canAcceptTypedInput?.());
      push("live.sendTypedText.result", { text, result });
      return result;
    }),
    canSendTypedText: spy("live.canSendTypedText", () => {
      const result = Boolean(scenario.liveOptions?.canAcceptTypedInput?.());
      push("live.canSendTypedText.result", { result });
      return result;
    }),
    speakAsK: spy("live.speakAsK", () => true),
    sendActivityStart: spy("live.sendActivityStart", () => true),
    sendActivityEnd: spy("live.sendActivityEnd", () => true),
    hasPendingAutoSpeech: spy("live.hasPendingAutoSpeech", () => false),
    unlockAudio: spy("live.unlockAudio", async () => true),
    setKSpeechAllowed: spy("live.setKSpeechAllowed"),
    appendTurn: spy("live.appendTurn"),
    lockNow: spy("live.lockNow"),
    speakClosingLine: spy("live.speakClosingLine", () => true),
    logTelemetryEvent: spy("live.logTelemetryEvent"),
    cancelCurrentGeneration: spy("live.cancelCurrentGeneration"),
  };

  return scenario;
};

const question = {
  id: "q1",
  question_text: "오늘 가장 기억에 남는 일은 뭐야?",
  dashboard_area_tag: "daily",
  cycle_type: "daily",
  round_type: "common",
};

const fetchMock = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  runtime.push("fetch", { url, method: init?.method ?? "GET" });
  if (url === "/api/child/test-mode") return createResponse({ selectedMode: null });
  if (url === "/api/child/me") return createResponse({ id: "child-1" });
  if (url === "/api/config/child-time-restrictions") {
    return createResponse({ enabled: false, scheduleEnforced: false, activeRound: null });
  }
  if (url.startsWith("/api/mission/v3/today-progress")) {
    const isLocked = runtime.kind === "locked";
    const isResumed = runtime.kind === "resumed";
    return createResponse({
      policyVersion: "v2_dual",
      effectiveAt: "2026-08-14T00:00:00.000Z",
      businessDate: "2026-08-14",
      entryState: isLocked ? "completed" : isResumed ? "resume" : "start",
      canEnter: !isLocked,
      canStartNew: !isLocked && !isResumed,
      sessionId: isLocked ? "locked-session" : isResumed ? "resumed-session" : null,
      status: isLocked ? "COMPLETED" : isResumed ? "IN_PROGRESS" : null,
      completed: isLocked,
      blockReason: isLocked ? "daily_limit_reached" : null,
      progress: isLocked || isResumed
        ? { kind: "valid_answers", current: isLocked ? 5 : 1, target: 5 }
        : null,
      timeGate: {
        enabled: false,
        allowedForNewStart: !isLocked,
        scheduleEnforced: false,
        reason: null,
      },
      roundType: "common",
      clientContext: {
        actorUserId: "user-1",
        familyId: "family-1",
        childId: "child-1",
        businessDate: "2026-08-14",
      },
    });
  }
  if (url === "/api/mission/start") {
    const request = JSON.parse(String(init?.body ?? "{}"));
    runtime.push("mission.start.request", { request });
    if (request.checkOnly && runtime.kind === "locked") {
      return createResponse({ locked: true, alreadyCompletedToday: true, roundType: "common" });
    }
    if (request.checkOnly && runtime.kind === "new") {
      return createResponse({ resumed: false, voiceMode: runtime.voiceMode, requiredCount: 5 });
    }
    return createResponse({
      resumed: runtime.kind === "resumed",
      sessionId: `${runtime.kind}-session`,
      questions: [question],
      questionStates: { q1: "pending" },
      validAnswerCount: runtime.kind === "resumed" ? 1 : 0,
      progressPercent: runtime.kind === "resumed" ? 20 : 0,
      requiredCount: 5,
      completed: false,
      engine_version: "v2",
      voiceMode: runtime.voiceMode,
      givenName: "민준",
    });
  }
  if (url.startsWith("/api/chat/messages?")) {
    return createResponse({ messages: [] });
  }
  if (url === "/api/client-version" && (init?.method ?? "GET") === "GET") {
    // 서버가 클라이언트와 **같은** 빌드를 돌려준다는 뜻이다. 리터럴을 박으면 안 된다 —
    // 예전엔 `"local"` 이었는데 f144dd0 이 clientVersionGate 의 "local 이면 통과" 예외를
    // 없애면서(CLI 배포에서 갱신 검사가 무력화되던 경로) 이 mock 만 남아 어긋났다.
    // 그 뒤로 이 파일의 테스트 4건은 미션 화면이 아니라 "미션 상태를 확인하지 못했어요"
    // 오류 화면만 보고 있었다 — 통과할 리 없고, 통과했어도 아무것도 검증하지 않는다.
    return createResponse({ buildId: BUILD_STAMP });
  }
  if (url === "/api/client-version") return createResponse({ ok: true });
  return createResponse({ ok: true });
});

const stableSearchParams = new URLSearchParams("childId=child-1&roundType=common");
const stableRouter = {
  push: (...args: unknown[]) => runtime?.push("router.push", { args }),
  replace: (...args: unknown[]) => runtime?.push("router.replace", { args }),
  refresh: (...args: unknown[]) => runtime?.push("router.refresh", { args }),
};

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => stableRouter,
    useSearchParams: () => stableSearchParams,
  },
});

mock.module("@/hooks/useVoiceChat", {
  namedExports: {
    useVoiceChat: (options: Record<string, unknown>) => {
      const [status, setStatus] = useState("idle");
      runtime.sttStatusSetter = setStatus;
      runtime.sttOptions = options;
      runtime.push("stt.render", { status });
      return {
        status,
        error: null,
        transcript: [],
        interimChildText: "",
        isSpeaking: false,
        isResponding: false,
        ...runtime.stt,
      };
    },
  },
});

mock.module("@/hooks/useGeminiLive", {
  namedExports: {
    useGeminiLive: (options: Record<string, unknown>) => {
      const [status, setStatus] = useState("idle");
      runtime.liveStatusSetter = setStatus;
      runtime.liveOptions = options;
      runtime.push("live.render", { status });
      return {
        status,
        error: null,
        transcript: [],
        interimChildText: "",
        audioLocked: false,
        noAudioInput: false,
        connectionQuality: 5,
        ...runtime.live,
      };
    },
  },
});

mock.module("@/components/MissionConversationLayout", {
  namedExports: {
    MissionConversationLayout: (props: Record<string, unknown>) => {
      runtime.latestLayoutProps = props;
      runtime.push("layout.render", {
        entryStatus: props.entryStatus,
        isAuto: props.isAuto,
        isRecording: props.isRecording,
        isTextMode: props.isTextMode,
        textInput: props.textInput,
        voiceState: props.voiceState,
      });
      return React.createElement("section", { "data-testid": "mission-layout" },
        React.createElement("output", { "data-testid": "entry-status" }, String(props.entryStatus)),
        React.createElement("button", { "data-testid": "start", onClick: props.onStartMission }, "start"),
        React.createElement("button", { "data-testid": "resume", onClick: props.onResumeMission }, "resume"),
        React.createElement("button", { "data-testid": "toggle-keyboard", onClick: props.onToggleTextMode }, "keyboard"),
        React.createElement("input", {
          "data-testid": "typed-input",
          value: props.textInput,
          onInput: (event: React.FormEvent<HTMLInputElement>) => props.onChangeTextInput(event.currentTarget.value),
        }),
        React.createElement("button", { "data-testid": "send", onClick: props.onSendText }, "send"),
      );
    },
  },
});

mock.module("@/app/demo/components/DemoFrame", {
  namedExports: { DemoFrame: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) },
});
mock.module("@/components/KChatbotWidget", { defaultExport: () => null });
mock.module("@/components/TestModeERunner", { namedExports: { TestModeERunner: () => null } });
mock.module("@/components/TestModeCDRunner", { namedExports: { TestModeCDRunner: () => null } });
mock.module("@/components/TestModeABRunner", { namedExports: { TestModeABRunner: () => null } });
mock.module("@/hooks/useScreenWakeLock", { namedExports: { useScreenWakeLock: () => false } });
mock.module("@/hooks/usePipelineConnectionQuality", {
  namedExports: {
    usePipelineConnectionQuality: () => ({
      quality: 5,
      recordStageResult: () => {},
      recordNormalTurn: () => {},
    }),
  },
});
mock.module("@/lib/mission/pendingTurnStore", {
  namedExports: {
    readPendingMissionTurn: async () => null,
    clearPendingMissionTurn: async () => {},
    savePendingMissionTurn: async () => {},
  },
});

const flushReact = async (cycles = 8) => {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const query = <T extends Element>(testId: string) => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing element: ${testId}`);
  return element as T;
};

const click = async (testId: string) => {
  await act(async () => {
    query<HTMLElement>(testId).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
};

const typeText = async (value: string) => {
  const input = query<HTMLInputElement>("typed-input");
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(valueSetter);
  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await flushReact();
};

const mountScenario = async (kind: Exclude<ScenarioKind, "locked">, voiceMode: VoiceMode) => {
  runtime = createScenarioRuntime(kind, voiceMode);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("k_child_id", "child-1");
  localStorage.setItem("k_voice_input_mode:child-1", "manual");
  window.__K_BESTIE_MISSION_RUNTIME_TRACE__ = (event: string, snapshot: Record<string, unknown>) => {
    runtime.push(`page.${event}`, snapshot);
  };
  root = createRoot(document.getElementById("root")!);
  await act(async () => root?.render(React.createElement(ChildMissionsPage)));
  await flushReact();
  const expectedEntry = kind === "new" ? "ready_to_start" : "ready_to_resume";
  assert.equal(query<HTMLOutputElement>("entry-status").textContent, expectedEntry);
  await click(kind === "new" ? "start" : "resume");
  assert.equal(query<HTMLOutputElement>("entry-status").textContent, "active");
};

const printTimeline = (label: string) => {
  console.log(`\n[REAL-REPRO:${label}]`);
  for (const item of runtime.timeline) console.log(JSON.stringify(item));
};

before(async () => {
  dom = new JSDOM("<!doctype html><html lang=\"ko\"><body><div id=\"root\"></div></body></html>", {
    url: "https://local.test/child/missions?childId=child-1&roundType=common",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    DOMException: dom.window.DOMException,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: fetchMock,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  const imported = await import("./page");
  ChildMissionsPage = imported.default;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "<div id=\"root\"></div>";
});

after(() => dom.window.close());

test("manual 신규 진입은 hydration 전에 setMicEnabled(true)를 호출하지 않는다", async () => {
  await mountScenario("new", "stt_tts");
  const hydrateQueued = runtime.timeline.findIndex((item) => item.event === "page.hydrate:queued");
  const trueMicCall = runtime.timeline.findIndex((item) => item.event === "stt.setMicEnabled" && item.args?.[0] === true);
  printTimeline("new-manual-mic");
  assert.ok(hydrateQueued >= 0, "hydration 완료 trace가 있어야 한다");
  assert.equal(trueMicCall, -1, "manual 신규 진입에서 setMicEnabled(true)가 호출되면 안 된다");
  assert.equal(runtime.latestLayoutProps?.isAuto, false);
  assert.equal(runtime.latestLayoutProps?.isRecording, false);
});

test("manual 신규 STT/TTS에서 keyboard 입력은 Live 전용 idle turnPhase와 무관하게 전송된다", async () => {
  await mountScenario("new", "stt_tts");
  await click("toggle-keyboard");
  await typeText("학교에서 축구했어");
  await click("send");
  printTimeline("new-keyboard-lock");
  const typedGuard = [...runtime.timeline].reverse().find((item) => item.event === "page.typed-guard");
  assert.deepEqual(typedGuard && {
    turnPhase: typedGuard.turnPhase,
    answerInFlight: typedGuard.answerInFlight,
    voiceMode: typedGuard.voiceMode,
    result: typedGuard.result,
  }, {
    turnPhase: "idle",
    answerInFlight: false,
    voiceMode: "stt_tts",
    result: true,
  });
  assert.equal(runtime.stt.sendTypedText.mock.callCount(), 1);
  assert.equal(runtime.latestLayoutProps?.textInput, "", "전송된 입력은 비워져야 한다");
});

test("manual 이어하기 STT/TTS도 mic true 없이 시작하며 keyboard 입력은 정상 전송된다", async () => {
  await mountScenario("resumed", "stt_tts");
  await click("toggle-keyboard");
  await typeText("이어하기 답변");
  await click("send");
  printTimeline("resumed-manual-keyboard-lock");
  assert.equal(runtime.timeline.some((item) => item.event === "stt.setMicEnabled" && item.args?.[0] === true), false);
  const typedGuard = [...runtime.timeline].reverse().find((item) => item.event === "page.typed-guard");
  assert.equal(typedGuard?.turnPhase, "idle");
  assert.equal(typedGuard?.result, true);
  assert.equal(runtime.stt.sendTypedText.mock.callCount(), 1);
});

test("오늘 완료한 미션에 재진입하면 재시작 없이 잠금 화면에서 자유대화로 이동한다", async () => {
  runtime = createScenarioRuntime("locked", "stt_tts");
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("k_child_id", "child-1");
  localStorage.setItem("k_voice_input_mode:child-1", "manual");
  root = createRoot(document.getElementById("root")!);

  await act(async () => root?.render(React.createElement(ChildMissionsPage)));
  await flushReact();

  assert.match(document.body.textContent ?? "", /오늘의 미션을 모두 완료했어요/);
  assert.doesNotMatch(document.body.textContent ?? "", /다시 할래요/);

  const startRequest = runtime.timeline.find((item) => item.event === "mission.start.request");
  assert.equal(startRequest, undefined, "완료 snapshot은 start API를 다시 호출하지 않아야 한다");

  await click("locked-completed-chat");
  const chatNavigation = runtime.timeline.find((item) => item.event === "router.replace" && Array.isArray(item.args) && item.args[0] === "/chat");
  assert.deepEqual(chatNavigation?.args, ["/chat"]);
});
