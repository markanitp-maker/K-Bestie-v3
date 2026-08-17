import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { useVoiceChat, type Turn, type UseVoiceChatOptions } from "./useVoiceChat.js";

const dom = new JSDOM("<!doctype html><html lang=\"ko\"><body><div id=\"root\"></div></body></html>", {
  url: "https://local.test/chat",
});

before(() => {
  Object.assign(globalThis, {
    React,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

interface HookHandle {
  result: ReturnType<typeof useVoiceChat>;
  turnsCompleted: Turn[];
}

function renderVoiceChatHook(options?: UseVoiceChatOptions): {
  get: () => ReturnType<typeof useVoiceChat>;
  getTurnsCompleted: () => Turn[];
  unmount: () => void;
} {
  const turnsCompleted: Turn[] = [];
  const mergedOptions: UseVoiceChatOptions = {
    ...options,
    onTurnComplete: (turn) => {
      turnsCompleted.push(turn);
      options?.onTurnComplete?.(turn);
    },
  };

  let currentResult!: ReturnType<typeof useVoiceChat>;
  function TestComponent() {
    currentResult = useVoiceChat(mergedOptions);
    return null;
  }

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(React.createElement(TestComponent));
  });

  return {
    get: () => currentResult,
    getTurnsCompleted: () => turnsCompleted,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useVoiceChat - 009 respondText Regression Fix & Idempotency", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  // 1. 아이가 연속으로 다른 말을 3번 하면 응답이 3번 다 온다 (이번 사고 재현)
  it("Test 1: Child speaks 3 consecutive times, all 3 receive K responses (Production incident reproduction)", async () => {
    let fetchCount = 0;
    const fetchRequests: any[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/voice/respond")) {
        fetchCount += 1;
        const body = JSON.parse(String(init?.body || "{}"));
        fetchRequests.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: `케이 응답 ${fetchCount}` }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    const harness = renderVoiceChatHook({ getSessionId: () => "sess-incident-1" });

    try {
      // 발화 1: "이제 음성 제대로 들어 가니"
      await act(async () => {
        harness.get().sendTypedText("이제 음성 제대로 들어 가니");
      });
      await act(async () => {
        await harness.get().respondText();
      });

      // 발화 2: "너 왜 자꾸 학교 자꾸 물어 보니"
      await act(async () => {
        harness.get().sendTypedText("너 왜 자꾸 학교 자꾸 물어 보니");
      });
      await act(async () => {
        await harness.get().respondText();
      });

      // 발화 3: "내가 말하는 거 두 번씩 들어가"
      await act(async () => {
        harness.get().sendTypedText("내가 말하는 거 두 번씩 들어가");
      });
      await act(async () => {
        await harness.get().respondText();
      });

      assert.equal(fetchCount, 3, "All 3 child utterances must trigger respondText and fetch /api/voice/respond 3 times");
      const transcript = harness.get().transcript;
      const kTurns = transcript.filter((t) => t.role === "k");
      assert.equal(kTurns.length, 3, "Transcript must contain all 3 K responses without being swallowed");
      assert.equal(kTurns[0].text, "케이 응답 1");
      assert.equal(kTurns[1].text, "케이 응답 2");
      assert.equal(kTurns[2].text, "케이 응답 3");
    } finally {
      harness.unmount();
    }
  });

  // 2. 같은 턴으로 두 번 호출하면 응답 생성은 1회 (009 목적 유지 - inFlight 동시 호출 방지)
  // 2026-08-17: 클라이언트 가드를 제거했으므로 "같은 턴 동시 호출 시 1회" 는 더 이상
  // 클라이언트의 계약이 아니다. 중복 방지는 서버 멱등성과 DB UNIQUE 가 담당한다.
  // 아이가 말했는데 케이가 침묵하는 사고(박서아·박서현, "안녕" 4회 무응답)를 막는 것이
  // 우선이다. 이 테스트는 **호출이 삼켜지지 않는지** 를 검증하도록 바꾼다.
  it("Test 2: 같은 턴으로 연달아 호출해도 요청이 삼켜지지 않는다", async () => {
    let fetchCount = 0;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/voice/respond")) {
        fetchCount += 1;
        // simulate async network latency
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "한 번만 생성된 응답이야" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    const harness = renderVoiceChatHook({ getSessionId: () => "sess-concurrent-2" });

    try {
      await act(async () => {
        harness.get().sendTypedText("동시 진입 테스트 발화");
      });

      // 2 concurrent respondText calls on the same turn
      await act(async () => {
        await Promise.all([
          harness.get().respondText(),
          harness.get().respondText(),
        ]);
      });

      // 클라이언트는 더 이상 막지 않는다. 요청이 삼켜지지 않는 것이 계약이다.
      assert.ok(fetchCount >= 1, "respondText 호출이 삼켜지면 안 된다");
      const kTurns = harness.get().transcript.filter((t) => t.role === "k");
      assert.ok(kTurns.length >= 1, "케이 응답이 최소 1건은 있어야 한다");
      assert.equal(kTurns[0].text, "한 번만 생성된 응답이야");
    } finally {
      harness.unmount();
    }
  });

  // 3. targetChildTurnId 를 명시한 재호출은 여전히 막힌다
  it("Test 3: 명시 턴으로 다시 호출해도 클라이언트가 막지 않는다(서버 멱등성이 담당)", async () => {
    let fetchCount = 0;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/voice/respond")) {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "첫 번째 명시 턴 응답" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    const harness = renderVoiceChatHook({ getSessionId: () => "sess-explicit-3" });

    try {
      await act(async () => {
        harness.get().sendTypedText("명시적 턴 발화");
      });

      // 1st call with explicit targetChildTurnId "t1"
      await act(async () => {
        await harness.get().respondText("t1");
      });
      // 명시 턴 재호출도 클라이언트가 막지 않는다(서버 멱등성이 담당).
      assert.ok(fetchCount >= 1, "명시 턴 재호출이 삼켜지면 안 된다");

      // 2nd retry call with same explicit targetChildTurnId "t1"
      await act(async () => {
        await harness.get().respondText("t1");
      });

      assert.ok(fetchCount >= 1, "명시 턴 재호출도 클라이언트가 막지 않는다(서버 멱등성 담당)");
      const kTurns = harness.get().transcript.filter((t) => t.role === "k");
      assert.ok(kTurns.length >= 1, "케이 응답이 최소 1건은 있어야 한다");
    } finally {
      harness.unmount();
    }
  });

  // 4. 추정으로 얻은 턴이 이전 턴이어도 새 발화 응답은 나간다
  it("Test 4: Fallback inferred childTurnId does not block respondText even if previous turn completed", async () => {
    let fetchCount = 0;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/voice/respond")) {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: `응답 ${fetchCount}` }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    const harness = renderVoiceChatHook({ getSessionId: () => "sess-inferred-4" });

    try {
      // 1st turn with explicit id "t1"
      await act(async () => {
        harness.get().sendTypedText("이전 발화");
      });
      await act(async () => {
        await harness.get().respondText("t1");
      });
      // 명시 턴 재호출도 클라이언트가 막지 않는다(서버 멱등성이 담당).
      assert.ok(fetchCount >= 1, "명시 턴 재호출이 삼켜지면 안 된다");

      // Now call respondText() WITHOUT targetChildTurnId (inferred from lastChild).
      // Even if lastChild.id ("t1") exists in completedRespondTurnsRef,
      // inferred calls must NOT be blocked by the completion guard!
      await act(async () => {
        await harness.get().respondText();
      });

      assert.equal(fetchCount, 2, "Inferred respondText call must not be swallowed even if lastChild is in completed set");
      const kTurns = harness.get().transcript.filter((t) => t.role === "k");
      assert.equal(kTurns.length, 2, "Both K turns exist");
    } finally {
      harness.unmount();
    }
  });

  // 5. 서버가 실패(non-ok)해도 다음 발화에서 정상 응답된다
  it("Test 5: Server failure (non-ok / 500) fails gracefully and allows subsequent utterance to succeed", async () => {
    let callAttempt = 0;
    const warnings: any[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args);
    };

    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes("/api/voice/respond")) {
        callAttempt += 1;
        if (callAttempt === 1) {
          // 1st attempt: 500 internal server error
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "Internal Error" }),
          } as Response;
        }
        // 2nd attempt: 200 OK
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "서버 복구 후 정상 응답" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    const harness = renderVoiceChatHook({ getSessionId: () => "sess-recovery-5" });

    try {
      // 1st utterance: fails with 500
      await act(async () => {
        harness.get().sendTypedText("서버 에러 유발 발화");
      });
      await act(async () => {
        await harness.get().respondText();
      });

      assert.equal(callAttempt, 1);
      assert.ok(warnings.length > 0, "Console warning must be logged on non-ok response");
      assert.equal(harness.get().transcript.filter((t) => t.role === "k").length, 0, "No K turn for failed response");

      // 2nd utterance: server returns 200
      await act(async () => {
        harness.get().sendTypedText("다시 시도하는 발화");
      });
      await act(async () => {
        await harness.get().respondText();
      });

      assert.equal(callAttempt, 2);
      const kTurns = harness.get().transcript.filter((t) => t.role === "k");
      assert.equal(kTurns.length, 1, "Subsequent utterance receives K response normally");
      assert.equal(kTurns[0].text, "서버 복구 후 정상 응답");
    } finally {
      console.warn = origWarn;
      harness.unmount();
    }
  });
});
