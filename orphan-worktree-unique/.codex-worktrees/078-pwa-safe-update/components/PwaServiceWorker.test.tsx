import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { PwaServiceWorker } from "./PwaServiceWorker";
import {
  publishConversationActivity,
  setConversationActivityReady,
  _resetConversationActivityStoreForTest,
} from "../lib/pwa/conversationActivity";
import {
  publishRouteReady,
  _resetRouteReadinessStoreForTest,
} from "../lib/pwa/routeReadiness";
import { setReloadPendingMarker, clearReloadPendingMarker } from "../lib/pwa/updateFlow";
import { BUILD_STAMP } from "../lib/pwa/buildStamp";

const projectRequire = createRequire(import.meta.url);
const sandboxRequire = createRequire("/tmp/p0-real-repro-jsdom-runtime/package.json");
const { JSDOM } = (() => {
  try {
    return projectRequire("jsdom");
  } catch {
    return sandboxRequire("jsdom");
  }
})();

const dom = new JSDOM(
  '<!doctype html><html lang="ko"><body><div id="sibling-app" aria-hidden="false">App Content</div></body></html>',
  {
    url: "http://localhost/",
  }
);

let telemetryEvents: Array<{ event_type: string; errorCode?: string }> = [];
let reloadsCount = 0;
let fetchMockResponses: Map<string, unknown> = new Map();
let clientVersionCheckCount = 0;

before(() => {
  if (typeof globalThis.MessageChannel === "undefined" || !globalThis.MessageChannel) {
    class MockMessagePort {
      onmessage: ((event: MessageEvent) => void) | null = null;
      otherPort: MockMessagePort | null = null;
      postMessage(data: unknown) {
        if (this.otherPort && typeof this.otherPort.onmessage === "function") {
          const handler = this.otherPort.onmessage;
          queueMicrotask(() => {
            handler({ data } as MessageEvent);
          });
        }
      }
      close() {}
    }

    class MockMessageChannel {
      port1: MockMessagePort;
      port2: MockMessagePort;
      constructor() {
        this.port1 = new MockMessagePort();
        this.port2 = new MockMessagePort();
        this.port1.otherPort = this.port2;
        this.port2.otherPort = this.port1;
      }
    }

    (globalThis as any).MessageChannel = MockMessageChannel;
  }

  const mockReload = () => {
    reloadsCount++;
  };

  const origLocation = dom.window.location;
  const mockLocation = new Proxy(origLocation, {
    get(target, prop, receiver) {
      if (prop === "reload") {
        return mockReload;
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === "function") {
        return val.bind(target);
      }
      return val;
    },
  });

  try {
    Object.defineProperty(dom.window, "location", {
      configurable: true,
      get() {
        return mockLocation;
      },
    });
  } catch {}
  try {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      get() {
        return mockLocation;
      },
    });
  } catch {}

  // Override History.prototype.pushState in JSDOM
  try {
    dom.window.History.prototype.pushState = function () {};
  } catch {}

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    PopStateEvent: dom.window.PopStateEvent,
    StorageEvent: dom.window.StorageEvent,
    history: dom.window.history,
    sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  _resetConversationActivityStoreForTest();
  setConversationActivityReady(true);
  _resetRouteReadinessStoreForTest();
  clearReloadPendingMarker();
  telemetryEvents = [];
  reloadsCount = 0;
  try {
    delete (dom.window.Location.prototype as any).reload;
    (dom.window.Location.prototype as any).reload = () => {
      reloadsCount++;
    };
  } catch {}
  clientVersionCheckCount = 0;
  fetchMockResponses.clear();

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = String(url);
    if (urlString.includes("/api/analytics/pwa-update")) {
      if (init?.body) {
        try {
          const parsed = JSON.parse(String(init.body)) as { event_type: string; error_code?: string };
          telemetryEvents.push({ event_type: parsed.event_type, errorCode: parsed.error_code });
        } catch {}
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }

    if (urlString.includes("/api/client-version")) {
      clientVersionCheckCount++;
      const mock = fetchMockResponses.get("/api/client-version");
      if (mock) {
        if ((mock as { status?: number }).status === 500) {
          return { ok: false, status: 500 } as Response;
        }
        return { ok: true, status: 200, json: async () => mock } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          buildId: BUILD_STAMP,
          buildStamp: BUILD_STAMP,
          deploymentId: "dep123",
          swVersion: "1.0.0",
        }),
      } as Response;
    }

    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;

  const listeners: Record<string, Function[]> = { controllerchange: [], message: [] };

  const mockSwController = {
    postMessage: (msg: unknown, ports?: MessagePort[]) => {
      if (typeof msg === "object" && msg !== null && (msg as { type?: string }).type === "PWA_GET_IDENTITY") {
        const nonce = (msg as { requestNonce: string }).requestNonce;
        const resp = {
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: nonce,
          buildId: BUILD_STAMP,
          swVersion: "1.0.0",
          workerNonce: "nonce123",
        };
        if (ports && ports[0]) {
          ports[0].postMessage(resp);
        }
      }
    },
  };

  const serviceWorkerMock = {
    controller: mockSwController,
    addEventListener: (event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: (event: string, fn: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    register: async () => ({
      waiting: null,
      installing: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      update: async () => {},
    }),
    getRegistration: async () => null,
    _dispatchControllerChange: () => {
      (listeners.controllerchange || []).forEach((fn) => fn());
    },
  };

  Object.defineProperty(dom.window.navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: serviceWorkerMock,
  });

  if (typeof globalThis.navigator !== "undefined" && globalThis.navigator) {
    try {
      Object.defineProperty(globalThis.navigator, "serviceWorker", {
        configurable: true,
        writable: true,
        value: serviceWorkerMock,
      });
    } catch {}
  }
});

after(() => dom.window.close());

function createTestContainer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
};

test("controllerchange alone yields zero success telemetry and zero modal close success", async () => {
  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    await act(async () => {
      (dom.window.navigator.serviceWorker as any)._dispatchControllerChange();
    });
    await flush();

    const successEvents = telemetryEvents.filter((e) => e.event_type === "pwa_update_success");
    assert.equal(successEvents.length, 0, "controllerchange alone MUST NOT emit pwa_update_success");
  } finally {
    cleanup();
  }
});

test("post-reload triple match yields exactly one pwa_update_success telemetry", async () => {
  setReloadPendingMarker({
    proposalId: "prop123",
    targetBuild: BUILD_STAMP,
    startedAt: Date.now(),
  });

  fetchMockResponses.set("/api/client-version", {
    buildId: BUILD_STAMP,
    buildStamp: BUILD_STAMP,
    deploymentId: "dep123",
    swVersion: "1.0.0",
  });

  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    const successEvents = telemetryEvents.filter((e) => e.event_type === "pwa_update_success");
    assert.equal(successEvents.length, 1, "Triple match MUST emit pwa_update_success exactly 1 time");
  } finally {
    cleanup();
  }
});

test("active tab controllerchange reload count is zero, then after safe reload count is one", async () => {
  publishConversationActivity("mission", true);

  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    await act(async () => {
      (dom.window.navigator.serviceWorker as any)._dispatchControllerChange();
    });
    await flush();

    assert.equal(reloadsCount, 0, "Active tab must NOT reload on controllerchange");

    await act(async () => {
      publishRouteReady("/", 0);
      publishConversationActivity("mission", false);
    });
    await flush();

    assert.equal(reloadsCount, 1, "Active tab must reload after hazards clear and route ready");
  } finally {
    cleanup();
  }
});

test("network-failure branch does not block UI or call reload", async () => {
  fetchMockResponses.set("/api/client-version", { status: 500 });

  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    const modal = document.querySelector("[data-testid='pwa-update-gate-modal']");
    assert.equal(modal, null, "network-failure must NOT display blocking modal");
    assert.equal(reloadsCount, 0, "network-failure must NOT trigger reload");
  } finally {
    cleanup();
  }
});

test("Escape key, backdrop click, and back history cannot bypass blocking modal", async () => {
  setReloadPendingMarker({
    proposalId: "prop123",
    targetBuild: "2026-08-15.new",
    startedAt: Date.now(),
  });

  fetchMockResponses.set("/api/client-version", { status: 500 });

  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    const modal = document.querySelector("[data-testid='pwa-update-gate-modal']");
    assert.ok(modal, "Modal should be open in VERIFYING_ERROR state");

    const escapeEvent = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    await act(async () => {
      dom.window.dispatchEvent(escapeEvent);
    });
    await flush();

    const warning = document.querySelector("[data-testid='pwa-update-nav-warning']");
    assert.equal(warning?.textContent, "업데이트를 진행해 주세요.");
  } finally {
    cleanup();
  }
});

test("app siblings get aria-hidden and inert when modal opens, and restored on unmount", async () => {
  setReloadPendingMarker({
    proposalId: "prop123",
    targetBuild: "2026-08-15.new",
    startedAt: Date.now(),
  });

  fetchMockResponses.set("/api/client-version", { status: 500 });

  const sibling = document.getElementById("sibling-app");
  assert.ok(sibling);
  const initialAria = sibling.getAttribute("aria-hidden");

  const { root, cleanup } = createTestContainer();

  await act(async () => {
    root.render(<PwaServiceWorker />);
  });
  await flush();

  assert.equal(sibling.getAttribute("aria-hidden"), "true");
  assert.equal(sibling.hasAttribute("inert"), true);

  cleanup();

  assert.equal(sibling.getAttribute("aria-hidden"), initialAria);
  assert.equal(sibling.hasAttribute("inert"), false);
});

test("safe route readiness triggers version check 1 time when published", async () => {
  const { root, cleanup } = createTestContainer();

  try {
    await act(async () => {
      root.render(<PwaServiceWorker />);
    });
    await flush();

    const initialChecks = clientVersionCheckCount;

    await act(async () => {
      publishRouteReady("/", 0);
    });
    await flush();

    assert.equal(
      clientVersionCheckCount - initialChecks,
      1,
      "Publishing route readiness MUST trigger check exactly 1 time"
    );
  } finally {
    cleanup();
  }
});
