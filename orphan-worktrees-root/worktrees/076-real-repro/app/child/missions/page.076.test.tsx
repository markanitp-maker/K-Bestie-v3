import React, { type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type LiveOptions = {
  canAcceptTypedInput?: () => boolean;
  getSessionId?: () => string | null;
  onAudioQueueDrained?: () => void;
  onTurnComplete?: (turn: { role: "child" | "k"; text: string }) => void;
};

const control = vi.hoisted(() => ({
  liveStatus: "ended",
  liveOptions: undefined as LiveOptions | undefined,
  rerenderLiveHook: undefined as (() => void) | undefined,
  liveHookInstances: 0,
  connectionSequence: 0,
  connectionIds: [] as string[],
  startedSessionIds: [] as Array<string | null>,
  startSession: vi.fn(),
  stopSession: vi.fn(),
  sendActivityEnd: vi.fn(),
  sendActivityStart: vi.fn(() => true),
  setMicEnabled: vi.fn(),
  setAudioMuted: vi.fn(),
  setInteractionMode: vi.fn(),
  sendTypedText: vi.fn(),
  canSendTypedText: vi.fn(),
  hasPendingAutoSpeech: vi.fn(() => false),
  speakAsK: vi.fn(() => true),
  sttStartSession: vi.fn(),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  missionStartCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => {
  const searchParams = new URLSearchParams("childId=child-076&roundType=common");
  const router = {
    replace: control.routerReplace,
    push: control.routerPush,
    refresh: control.routerRefresh,
  };
  return {
    useRouter: () => router,
    useSearchParams: () => searchParams,
  };
});

vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <span data-testid="next-image" {...props} />,
}));

vi.mock("@/app/demo/components/DemoFrame", () => ({
  DemoFrame: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/KBestieMascotAnimation", () => ({
  KBestieMascotAnimation: () => <div data-testid="mascot" />,
}));

vi.mock("@/components/AppTopHeader", () => ({
  AppTopHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));

vi.mock("@/components/KChatbotWidget", () => ({ default: () => null }));
vi.mock("@/components/Skeleton", () => ({ SkeletonBox: () => <div data-testid="skeleton" /> }));
vi.mock("@/components/VoiceInputModeSwitch", () => ({ VoiceInputModeSwitch: () => null }));
vi.mock("@/components/TestModeERunner", () => ({ TestModeERunner: () => null }));
vi.mock("@/components/TestModeCDRunner", () => ({ TestModeCDRunner: () => null }));
vi.mock("@/components/TestModeABRunner", () => ({ TestModeABRunner: () => null }));
vi.mock("@/components/ConnectionQualityIndicator", () => ({ ConnectionQualityIndicator: () => null }));

vi.mock("@/hooks/useKeyboardConversationViewport", () => ({
  useKeyboardConversationViewport: () => ({ viewportHeight: 800, isKeyboardOpen: false }),
}));

vi.mock("@/hooks/useScreenWakeLock", () => ({ useScreenWakeLock: () => false }));
vi.mock("@/hooks/usePipelineConnectionQuality", () => ({
  usePipelineConnectionQuality: () => ({
    quality: "good",
    recordStageResult: vi.fn(),
    recordNormalTurn: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVoiceChat", () => ({
  useVoiceChat: () => ({
    status: "ended",
    error: null,
    transcript: [],
    interimChildText: "",
    isSpeaking: false,
    startSession: control.sttStartSession,
    stopSession: vi.fn(),
    setMicEnabled: vi.fn(),
    setInputMode: vi.fn(),
    cancelFinalize: vi.fn(),
    stopSpeaking: vi.fn(),
    manualFinalize: vi.fn(),
    sendTypedText: vi.fn(),
    speak: vi.fn(async () => undefined),
    sayText: vi.fn(),
    getTranscript: () => [],
    seedTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useGeminiLive", async () => {
  const React = await import("react");

  return {
    useGeminiLive: (options: LiveOptions) => {
      const instanceRef = React.useRef<string | null>(null);
      const [, setVersion] = React.useState(0);
      if (instanceRef.current === null) {
        instanceRef.current = `live-hook-${++control.liveHookInstances}`;
      }
      control.liveOptions = options;
      React.useEffect(() => {
        control.rerenderLiveHook = () => setVersion((version) => version + 1);
        return () => {
          control.rerenderLiveHook = undefined;
        };
      }, []);

      return {
        status: control.liveStatus,
        error: null,
        transcript: [],
        interimChildText: "",
        audioLocked: false,
        noAudioInput: false,
        connectionQuality: 5,
        startSession: control.startSession,
        stopSession: control.stopSession,
        setMicEnabled: control.setMicEnabled,
        setAudioMuted: control.setAudioMuted,
        setInteractionMode: control.setInteractionMode,
        sendActivityStart: control.sendActivityStart,
        sendActivityEnd: control.sendActivityEnd,
        hasPendingAutoSpeech: control.hasPendingAutoSpeech,
        canSendTypedText: control.canSendTypedText,
        sendTypedText: control.sendTypedText,
        speakAsK: control.speakAsK,
        setKSpeechAllowed: vi.fn(),
        getTranscript: () => [],
        seedTranscript: vi.fn(),
        appendTurn: vi.fn(),
        lockNow: vi.fn(),
        unlockAudio: vi.fn(async () => true),
        logTelemetryEvent: vi.fn(),
      };
    },
  };
});

vi.mock("@/lib/mission/pendingTurnStore", () => ({
  readPendingMissionTurn: vi.fn(async () => null),
  savePendingMissionTurn: vi.fn(() => new Promise(() => undefined)),
  clearPendingMissionTurn: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mission/turnRequest", () => ({
  postMissionTurnWithRetry: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock("@/lib/mission/personalizedReaction", () => ({
  fetchPersonalizedReaction: vi.fn(async () => "좋아"),
}));

vi.mock("@/lib/voiceTimelineLog", () => ({ logVoiceEvent: vi.fn() }));

import ChildMissionsPage from "./page";

const jsonResponse = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
  ...init,
});

const installFetchMock = () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/child/test-mode") return jsonResponse({ selectedMode: null });
    if (url === "/api/config/child-time-restrictions") {
      return jsonResponse({ enabled: false, scheduleEnforced: false, activeRound: null });
    }
    if (url === "/api/mission/start") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      control.missionStartCalls.push(body);
      if (body.checkOnly) {
        return jsonResponse({ resumed: false, voiceMode: "live", requiredCount: 5 });
      }
      return jsonResponse({
        sessionId: "session-076-stable",
        resumed: true,
        voiceMode: "live",
        requiredCount: 5,
        questionStates: { q1: "pending" },
        questions: [{
          id: "q1",
          question_text: "오늘 가장 기억나는 일은 뭐야?",
          dashboard_area_tag: "daily",
          cycle_type: "daily",
          round_type: "common",
        }],
      });
    }
    if (url.startsWith("/api/chat/messages?")) return jsonResponse({ messages: [] });
    if (url === "/api/client-version") return jsonResponse({ ok: true });
    return jsonResponse({ ok: true });
  }));
};

const setLiveStatus = async (status: string) => {
  await act(async () => {
    control.liveStatus = status;
    control.rerenderLiveHook?.();
  });
};

const renderActiveLiveMission = async () => {
  render(<ChildMissionsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "새 미션 시작하기" }));
  await waitFor(() => expect(control.startSession).toHaveBeenCalledTimes(1));
  await screen.findByText("말하는 중");
};

describe("076 실제 MissionsPage jsdom 실행", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("k_child_id", "child-076");
    control.liveStatus = "ended";
    control.liveOptions = undefined;
    control.rerenderLiveHook = undefined;
    control.liveHookInstances = 0;
    control.connectionSequence = 0;
    control.connectionIds = [];
    control.startedSessionIds = [];
    control.missionStartCalls = [];
    control.startSession.mockImplementation(async () => {
      control.connectionIds.push(`connection-${++control.connectionSequence}`);
      control.startedSessionIds.push(control.liveOptions?.getSessionId?.() ?? null);
      await setLiveStatus("live");
    });
    control.canSendTypedText.mockImplementation(() => control.liveOptions?.canAcceptTypedInput?.() ?? false);
    control.sendTypedText.mockImplementation(() => control.liveOptions?.canAcceptTypedInput?.() ?? false);
    installFetchMock();
  });

  it("키보드 overlay를 열 때 session/connection을 재생성하거나 activityEnd/stop을 호출하지 않는다", async () => {
    await renderActiveLiveMission();
    const baselineMicCalls = control.setMicEnabled.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "텍스트로 답하기" }));
    await screen.findByPlaceholderText("케이에게 텍스트로 답하기...");

    console.log("[076][open]", JSON.stringify({
      startSessionCalls: control.startSession.mock.calls.length,
      hookInstances: control.liveHookInstances,
      connectionIds: control.connectionIds,
      sessionIds: control.startedSessionIds,
      activityEndCalls: control.sendActivityEnd.mock.calls.length,
      stopSessionCalls: control.stopSession.mock.calls.length,
      micCallsAdded: control.setMicEnabled.mock.calls.length - baselineMicCalls,
    }));
    expect(control.startSession).toHaveBeenCalledTimes(1);
    expect(control.liveHookInstances).toBe(1);
    expect(control.connectionIds).toEqual(["connection-1"]);
    expect(control.startedSessionIds).toEqual(["session-076-stable"]);
    expect(control.sendActivityEnd).not.toHaveBeenCalled();
    expect(control.stopSession).not.toHaveBeenCalled();
  });

  it("열린 overlay가 대기/생각 중/말하는 중/연결 중 상태를 실제 DOM에 리렌더한다", async () => {
    await renderActiveLiveMission();
    fireEvent.click(screen.getByRole("button", { name: "수동" }));
    fireEvent.click(screen.getByRole("button", { name: "텍스트로 답하기" }));

    expect(await screen.findByText("말하는 중")).toBeTruthy();
    await act(async () => control.liveOptions?.onAudioQueueDrained?.());
    expect(screen.getByText("대기 중")).toBeTruthy();

    await act(async () => control.liveOptions?.onTurnComplete?.({ role: "child", text: "친구와 놀았어" }));
    expect(screen.getByText("생각 중")).toBeTruthy();

    await setLiveStatus("connecting");
    expect(screen.getByText("연결 중")).toBeTruthy();
    console.log("[076][badge] rendered=말하는 중→대기 중→생각 중→연결 중");
  });

  it("canAcceptTypedInput이 실제 페이지 턴 상태를 음성/텍스트 공통으로 판정한다", async () => {
    await renderActiveLiveMission();
    fireEvent.click(screen.getByRole("button", { name: "수동" }));
    await act(async () => control.liveOptions?.onAudioQueueDrained?.());
    expect(control.liveOptions?.canAcceptTypedInput?.()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "텍스트로 답하기" }));
    const input = await screen.findByPlaceholderText("케이에게 텍스트로 답하기...");
    fireEvent.change(input, { target: { value: "텍스트 답변" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(control.sendTypedText).toHaveBeenCalledWith("텍스트 답변");

    await act(async () => control.liveOptions?.onTurnComplete?.({ role: "child", text: "음성 답변" }));
    expect(control.liveOptions?.canAcceptTypedInput?.()).toBe(false);
    console.log("[076][turn-gate]", JSON.stringify({ childListening: true, waitingK: false }));
  });

  it("overlay를 닫고 음성 UI로 돌아와도 동일 session/connection을 유지한다", async () => {
    await renderActiveLiveMission();
    fireEvent.click(screen.getByRole("button", { name: "텍스트로 답하기" }));
    fireEvent.click(await screen.findByRole("button", { name: "텍스트 입력창 닫기" }));
    await screen.findByRole("button", { name: "텍스트로 답하기" });

    console.log("[076][close]", JSON.stringify({
      startSessionCalls: control.startSession.mock.calls.length,
      hookInstances: control.liveHookInstances,
      connectionIds: control.connectionIds,
      sessionIds: control.startedSessionIds,
      activityEndCalls: control.sendActivityEnd.mock.calls.length,
      stopSessionCalls: control.stopSession.mock.calls.length,
    }));
    expect(control.startSession).toHaveBeenCalledTimes(1);
    expect(control.liveHookInstances).toBe(1);
    expect(control.connectionIds).toEqual(["connection-1"]);
    expect(control.startedSessionIds).toEqual(["session-076-stable"]);
    expect(control.sendActivityEnd).not.toHaveBeenCalled();
    expect(control.stopSession).not.toHaveBeenCalled();
  });
});
