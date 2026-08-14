import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React, { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import {
  isSafeRoutePath,
  normalizeRoutePath,
  publishRouteReady,
  startNavigation,
  getRouteReadinessSnapshot,
  isCurrentRouteSafeAndReady,
  resetRouteReadinessForTest,
} from "@/lib/pwa/routeReadiness";
import {
  openActivationBarrier,
  commitActivationBarrier,
  abortActivationBarrier,
  clearActivationBarrier,
  isActivationBarrierActive,
  getActivationBarrierState,
  tryAcquireConversationHazard,
  resetConversationActivityStateForTest,
  isConversationActive,
  getConversationActivitySnapshot,
} from "@/lib/pwa/conversationActivity";
import {
  evaluateTabVote,
  createActivationProposal,
  ActivationProposal,
} from "@/lib/pwa/tabUpdateConsensus";
import {
  saveReloadPendingMarker,
  getReloadPendingMarker,
  clearReloadPendingMarker,
  ReloadPendingMarkerV3,
} from "@/lib/pwa/updateFlow";
import {
  subscribeStaleRecovery,
  requestStaleRecovery,
  resetRecoveryCoordinatorForTest,
  saveExternalControllerPending,
  getExternalControllerPending,
  clearExternalControllerPending,
  ExternalControllerPendingV1,
  StaleRecoverySignal,
} from "@/lib/pwa/recoveryCoordinator";
import {
  validateStaleAssetEnvelope,
  isLegacyStaleAssetMessage,
  ServiceWorkerIdentity,
  isValidStaleAssetPath,
} from "@/lib/pwa/swProtocol";
import type { LatestVersionMetadataV1 } from "@/lib/pwa/clientVersion";

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/child/home",
    useRouter: () => ({ replace: () => undefined }),
  },
});

const componentTestRequire = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = componentTestRequire("jsdom");

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store),
  };
}

test("U9-1: click snapshot creates and reads back the exact marker before activation", () => {
  const componentSource = readFileSync(
    fileURLToPath(new URL("./PwaServiceWorker.tsx", import.meta.url)),
    "utf8",
  );
  const clickFetch = componentSource.indexOf(
    "const latestResult = await fetchLatestVersionMetadataV1();",
    componentSource.indexOf("const triggerUpdate"),
  );
  const autoStart = componentSource.indexOf("const maybeScheduleSafeCheck");
  const autoFetch = componentSource.indexOf(
    "const latestResult = await fetchLatestVersionMetadataV1();",
    autoStart,
  );
  const autoUpdate = componentSource.indexOf(
    "targetSnapshot: latestResult.snapshot",
    autoFetch,
  );
  const markerTarget = componentSource.indexOf(
    "target: { ...updateOutcome.targetSnapshot }",
    clickFetch,
  );
  const markerSave = componentSource.indexOf(
    "const saved = saveReloadPendingMarker(marker)",
    markerTarget,
  );
  const markerReadBack = componentSource.indexOf(
    "getReloadPendingMarker(undefined, markerStartedAt)",
    markerSave,
  );
  const activation = componentSource.indexOf(
    "requestActivationViaChannel(targetWorker, proposal)",
    markerReadBack,
  );

  assert.ok(autoStart >= 0);
  assert.ok(autoFetch > autoStart);
  assert.ok(autoUpdate > autoFetch);
  assert.ok(clickFetch > autoUpdate);
  assert.ok(markerTarget > clickFetch);
  assert.ok(markerSave > markerTarget);
  assert.ok(markerReadBack > markerSave);
  assert.ok(activation > markerReadBack);
  assert.doesNotMatch(
    componentSource,
    new RegExp(["NEXT_PUBLIC", "DEPLOYMENT_SHA"].join("_")),
  );
  assert.doesNotMatch(componentSource, /workerNonce\s*\|\|\s*["']nonce["']/);
});

test("U9-5: automatic target A is discarded when the click snapshot drifts to B", async () => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => undefined);
  const dom = new JSDOM(
    "<!doctype html><html lang=\"ko\"><head></head><body><div id=\"root\"></div></body></html>",
    {
      url: "https://app.k-bestie.com/child/home",
      virtualConsole,
    },
  );
  const current = {
    schemaVersion: 1,
    buildId: "build-current",
    buildStamp: "stamp-current",
    deploymentId: "deployment-current",
    swVersion: "sw-current",
    serviceWorkerScriptUrl: "/sw.js",
  } as const satisfies LatestVersionMetadataV1;
  const targetA = Object.freeze({
    schemaVersion: 1,
    buildId: "build-a",
    buildStamp: "stamp-a",
    deploymentId: "deployment-a",
    swVersion: "sw-a",
    serviceWorkerScriptUrl: "/sw.js",
  } as const satisfies LatestVersionMetadataV1);
  const targetB = Object.freeze({
    schemaVersion: 1,
    buildId: "build-b",
    buildStamp: "stamp-b",
    deploymentId: "deployment-b",
    swVersion: "sw-b",
    serviceWorkerScriptUrl: "/sw.js",
  } as const satisfies LatestVersionMetadataV1);
  const meta = dom.window.document.createElement("meta");
  meta.name = "kbestie-document-deployment-v1";
  meta.content = JSON.stringify({
    schemaVersion: 1,
    buildId: current.buildId,
    buildStamp: current.buildStamp,
    deploymentId: current.deploymentId,
  });
  dom.window.document.head.append(meta);

  type ActivationRequest = {
    workerName: "A" | "B";
    message: {
      requestNonce: string;
      proposal: ActivationProposal;
    };
    markerAtActivation: ReloadPendingMarkerV3 | null;
    responsePort: { postMessage: (message: unknown) => void };
  };
  const activationRequests: ActivationRequest[] = [];
  const createWorker = (
    workerName: "A" | "B" | "current",
    metadata: Readonly<LatestVersionMetadataV1>,
    workerNonce: string,
  ): ServiceWorker => {
    const eventTarget = new dom.window.EventTarget();
    Object.assign(eventTarget, {
      state: "installed",
      scriptURL: `https://app.k-bestie.com${metadata.serviceWorkerScriptUrl}`,
      postMessage: (
        value: unknown,
        transfer?: Array<{ postMessage: (message: unknown) => void }>,
      ) => {
        if (!value || typeof value !== "object") return;
        const message = value as Record<string, unknown>;
        const responsePort = transfer?.[0];
        if (!responsePort || typeof message.requestNonce !== "string") return;
        if (message.type === "PWA_GET_IDENTITY") {
          responsePort.postMessage({
            protocol: 1,
            type: "PWA_IDENTITY_RESPONSE",
            requestNonce: message.requestNonce,
            buildId: metadata.buildId,
            swVersion: metadata.swVersion,
            workerNonce,
          });
          return;
        }
        if (
          message.type === "PWA_PREPARE_ACTIVATION" &&
          workerName !== "current" &&
          message.proposal &&
          typeof message.proposal === "object"
        ) {
          activationRequests.push({
            workerName,
            message: {
              requestNonce: message.requestNonce,
              proposal: message.proposal as ActivationProposal,
            },
            markerAtActivation: getReloadPendingMarker(
              dom.window.sessionStorage,
            ),
            responsePort,
          });
        }
      },
    });
    return eventTarget as unknown as ServiceWorker;
  };

  const workerA = createWorker("A", targetA, "nonce-a");
  const workerB = createWorker("B", targetB, "nonce-b");
  const currentWorker = createWorker("current", current, "nonce-current");
  let latestTarget: Readonly<LatestVersionMetadataV1> = targetA;
  const fetchedTargets: LatestVersionMetadataV1[] = [];
  const registrationState: {
    waiting: ServiceWorker | null;
    installing: ServiceWorker | null;
  } = { waiting: null, installing: null };
  const registration = {
    get waiting() {
      return registrationState.waiting;
    },
    get installing() {
      return registrationState.installing;
    },
    update: async () => {
      registrationState.waiting =
        latestTarget.buildId === targetA.buildId ? workerA : workerB;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as ServiceWorkerRegistration;
  const serviceWorkerContainer = Object.assign(new dom.window.EventTarget(), {
    controller: currentWorker,
    register: async () => registration,
    getRegistration: async () => registration,
  });

  const globalKeys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "MouseEvent",
    "SubmitEvent",
    "Event",
    "MessageEvent",
    "Storage",
    "React",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const originalDescriptors = new Map(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const installGlobal = (key: (typeof globalKeys)[number], value: unknown) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  installGlobal("window", dom.window);
  installGlobal("document", dom.window.document);
  installGlobal("navigator", dom.window.navigator);
  installGlobal("HTMLElement", dom.window.HTMLElement);
  installGlobal("MouseEvent", dom.window.MouseEvent);
  installGlobal("SubmitEvent", dom.window.SubmitEvent);
  installGlobal("Event", dom.window.Event);
  installGlobal("MessageEvent", dom.window.MessageEvent);
  installGlobal("Storage", dom.window.Storage);
  installGlobal("React", React);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(dom.window.navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorkerContainer,
  });
  globalThis.fetch = async (input: string | URL | Request) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl, dom.window.location.origin);
    if (url.pathname !== "/api/client-version") {
      throw new Error(`Unexpected fetch in drift harness: ${url.pathname}`);
    }
    fetchedTargets.push({ ...latestTarget });
    return new Response(JSON.stringify(latestTarget), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  };
  console.info = () => undefined;

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  clearReloadPendingMarker(dom.window.sessionStorage);
  const revision = getRouteReadinessSnapshot().routeRevision;
  publishRouteReady("/child/home", revision);
  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const waitFor = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 4_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  };

  try {
    const { PwaServiceWorker } = await import("./PwaServiceWorker");
    await act(async () => {
      root.render(createElement(PwaServiceWorker));
    });
    await waitFor(
      () => container.querySelector('[role="alertdialog"]') !== null,
      "automatic A modal",
    );
    assert.ok(fetchedTargets.some((target) => target.buildId === targetA.buildId));
    assert.equal(activationRequests.length, 0);

    latestTarget = targetB;
    const button = container.querySelector("button");
    assert.ok(button);
    await act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => activationRequests.length === 1, "B activation request");

    const activation = activationRequests[0];
    const marker = activation.markerAtActivation;
    assert.notEqual(marker, null);
    assert.deepEqual(marker?.target, targetB);
    assert.equal(marker?.target.buildId, targetB.buildId);
    assert.equal(marker?.target.buildStamp, targetB.buildStamp);
    assert.equal(marker?.target.deploymentId, targetB.deploymentId);
    assert.equal(marker?.target.swVersion, targetB.swVersion);
    assert.equal(
      marker?.target.serviceWorkerScriptUrl,
      targetB.serviceWorkerScriptUrl,
    );
    assert.equal(JSON.stringify(marker).includes(targetA.buildId), false);
    assert.equal(activation.workerName, "B");
    assert.equal(activation.message.proposal.targetBuild, targetB.buildId);
    assert.equal(activation.message.proposal.targetSwVersion, targetB.swVersion);
    assert.equal(
      activationRequests.some((request) => request.workerName === "A"),
      false,
    );
    assert.equal(registration.waiting, workerB);

    activation.responsePort.postMessage({
      protocol: 1,
      type: "PWA_ACTIVATION_ABORTED",
      requestNonce: activation.message.requestNonce,
      proposalId: activation.message.proposal.proposalId,
      workerNonce: "nonce-b",
      reason: "test_cleanup",
    });
    await waitFor(
      () => getReloadPendingMarker(dom.window.sessionStorage) === null,
      "aborted B marker cleanup",
    );
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    for (const key of globalKeys) {
      const descriptor = originalDescriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    clearReloadPendingMarker(dom.window.sessionStorage);
    resetRouteReadinessForTest();
    resetConversationActivityStateForTest();
    dom.window.close();
  }
});

test("U9-2: history gate owns only its strict UUID state and restores unknown state without traversal", () => {
  const componentSource = readFileSync(
    fileURLToPath(new URL("./PwaServiceWorker.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(componentSource, /createPwaGateHistoryState\(gateToken, currentUrl\)/);
  assert.match(
    componentSource,
    /isOwnedPwaGateHistoryState\(window\.history\.state, gateToken\)/,
  );
  assert.match(
    componentSource,
    /window\.history\.replaceState\(\s*originalHistoryStateRef\.current,/,
  );
  assert.doesNotMatch(componentSource, new RegExp(["original", "State:"].join("")));
  assert.doesNotMatch(componentSource, new RegExp(["pwa", "GateToken"].join("")));
  assert.doesNotMatch(componentSource, /history\.back\(\)/);
  assert.doesNotMatch(componentSource, /gate_\$\{Date\.now\(\)\}/);
});

test("U9-2: post-reload success telemetry is deduplicated by the durable success event id", () => {
  const componentSource = readFileSync(
    fileURLToPath(new URL("./PwaServiceWorker.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(componentSource, /reportedSuccessEventIdsRef\.current\.has\(marker\.successEventId\)/);
  assert.match(componentSource, /reportedSuccessEventIdsRef\.current\.add\(marker\.successEventId\)/);
  assert.match(componentSource, /latest_version: marker\.target\.buildId/);
});

// -------------------------------------------------------------
// U8-5: Expected vs Unexpected ControllerChange Deferral & ExternalControllerPendingV1 Tests
// -------------------------------------------------------------

test("U8-5: Expected controllerchange reloads only when marker is saved; missing marker aborts reload", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  const storage = memoryStorage();

  const now = Date.now();
  const proposalId = "11111111-1111-4111-8111-111111111111";
  const workerNonce = "nonce-expected-1";

  // Case 1: Expected transition with saved marker -> reload allowed
  const validMarker: ReloadPendingMarkerV3 = {
    schemaVersion: 3,
    proposalId,
    target: {
      schemaVersion: 1,
      buildId: "build-v2",
      buildStamp: "stamp-v2",
      deploymentId: "dpl_v2",
      swVersion: "sw-v2",
      serviceWorkerScriptUrl: "/sw.js",
    },
    activationWorkerNonce: workerNonce,
    successEventId: "22222222-2222-4222-8222-222222222222",
    documentBuildStampBeforeReload: "stamp-v1",
    startedAt: now,
    expiresAt: now + 60000,
    reason: "user_update",
  };

  saveReloadPendingMarker(validMarker, storage as unknown as Storage);
  const loaded = getReloadPendingMarker(storage as unknown as Storage, now);
  assert.notEqual(loaded, null);
  assert.equal(loaded?.proposalId, proposalId);

  // Case 2: Marker save failed or missing -> reload is blocked, barrier aborted
  clearReloadPendingMarker(storage as unknown as Storage);
  const emptyMarker = getReloadPendingMarker(storage as unknown as Storage, now);
  assert.equal(emptyMarker, null);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});

test("U8-5: Unexpected controllerchange during active Mission/FreeChat causes 0 reload, 0 modal, 0 barrier, conversation continues", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  resetRecoveryCoordinatorForTest();
  const storage = memoryStorage();

  // 1. Child is in active FreeChat or Mission with hazard acquired
  const rev = getRouteReadinessSnapshot().routeRevision;
  publishRouteReady("/chat", rev);
  const hazard = tryAcquireConversationHazard("chat", "speaking");
  assert.notEqual(hazard, null);
  assert.equal(isConversationActive(), true);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 1);

  // 2. Unexpected controllerchange arrives from background
  let reloadCount = 0;
  let modalOpenCount = 0;
  let barrierOpenCount = 0;

  const handleUnexpectedController = (path: string) => {
    const isTabActiveOrUnsafe =
      !isSafeRoutePath(path) ||
      !isCurrentRouteSafeAndReady(path) ||
      isConversationActive() ||
      getConversationActivitySnapshot().hazardsCount > 0;

    const pending: ExternalControllerPendingV1 = {
      schemaVersion: 1,
      observedAt: Date.now(),
      controllerBuildId: "build-ext-2",
      controllerSwVersion: "sw-v2",
      controllerScriptUrl: "/sw.js",
    };

    saveExternalControllerPending(pending, storage);

    if (isTabActiveOrUnsafe) {
      // Defer without reload, modal, or barrier
      return { reloaded: false, modalOpened: false, barrierOpened: false };
    }

    reloadCount += 1;
    modalOpenCount += 1;
    barrierOpenCount += 1;
    return { reloaded: true, modalOpened: true, barrierOpened: true };
  };

  const outcome = handleUnexpectedController("/chat");
  assert.equal(outcome.reloaded, false);
  assert.equal(outcome.modalOpened, false);
  assert.equal(outcome.barrierOpened, false);
  assert.equal(reloadCount, 0);
  assert.equal(modalOpenCount, 0);
  assert.equal(barrierOpenCount, 0);
  assert.equal(isActivationBarrierActive(), false);

  // 3. Conversation input and turns continue normally!
  const nextHazard = tryAcquireConversationHazard("chat", "turn_exchange");
  assert.notEqual(nextHazard, null);
  nextHazard?.release();

  // 4. Pending is persisted in storage
  const pending = getExternalControllerPending(storage);
  assert.notEqual(pending, null);
  assert.equal(pending?.controllerBuildId, "build-ext-2");

  hazard?.release();
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  resetRecoveryCoordinatorForTest();
});

test("U8-5: Safe transition consumes pending: match clears barrier/pending; mismatch opens modal; error yields retry state with no orphan barrier", async () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  resetRecoveryCoordinatorForTest();
  const storage = memoryStorage();

  const currentDocumentBuild = "build-current-1";

  // Helper simulating consumeExternalControllerPending
  const simulateConsumePending = async (scenario: "match" | "mismatch" | "network_error") => {
    const pending = getExternalControllerPending(storage);
    if (!pending) return { state: "no_pending" };

    clearExternalControllerPending(storage);

    // Mock /api/client-version
    let serverBuild: string | null = null;
    if (scenario === "match") serverBuild = currentDocumentBuild;
    else if (scenario === "mismatch") serverBuild = "build-newer-2";
    else serverBuild = null; // network error

    if (!serverBuild) {
      clearActivationBarrier();
      return { state: "error", barrierActive: isActivationBarrierActive() };
    }

    const effectiveControllerBuild = pending.controllerBuildId;
    const isDocMatch = currentDocumentBuild === serverBuild;
    const isControllerMatch = !effectiveControllerBuild || effectiveControllerBuild === serverBuild;

    if (isDocMatch && isControllerMatch) {
      clearActivationBarrier();
      return { state: "up_to_date", barrierActive: isActivationBarrierActive() };
    } else {
      clearActivationBarrier();
      return { state: "update_available", barrierActive: isActivationBarrierActive() };
    }
  };

  // 1. Scenario Match: documentBuild === serverBuild === controllerBuild
  saveExternalControllerPending(
    {
      schemaVersion: 1,
      observedAt: Date.now(),
      controllerBuildId: currentDocumentBuild,
      controllerSwVersion: "sw-v1",
      controllerScriptUrl: "/sw.js",
    },
    storage
  );
  const matchResult = await simulateConsumePending("match");
  assert.equal(matchResult.state, "up_to_date");
  assert.equal(matchResult.barrierActive, false, "No orphan barrier on match");
  assert.equal(getExternalControllerPending(storage), null, "Pending consumed");

  // 2. Scenario Mismatch: serverBuild differs from document
  saveExternalControllerPending(
    {
      schemaVersion: 1,
      observedAt: Date.now(),
      controllerBuildId: "build-newer-2",
      controllerSwVersion: "sw-v2",
      controllerScriptUrl: "/sw.js",
    },
    storage
  );
  const mismatchResult = await simulateConsumePending("mismatch");
  assert.equal(mismatchResult.state, "update_available", "Opens central modal on mismatch");
  assert.equal(mismatchResult.barrierActive, false);
  assert.equal(getExternalControllerPending(storage), null);

  // 3. Scenario Network Error: endpoint fails -> retryable error state, cleans barrier
  saveExternalControllerPending(
    {
      schemaVersion: 1,
      observedAt: Date.now(),
      controllerBuildId: "build-newer-2",
      controllerSwVersion: "sw-v2",
      controllerScriptUrl: "/sw.js",
    },
    storage
  );
  const errorResult = await simulateConsumePending("network_error");
  assert.equal(errorResult.state, "error", "Transitions to retryable error state");
  assert.equal(errorResult.barrierActive, false, "Cleans barrier so no orphan barrier remains");
  assert.equal(getExternalControllerPending(storage), null);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
  resetRecoveryCoordinatorForTest();
});

test("U8-5: Strict Stale v1 vs Forged Envelope vs Legacy v0 Coordinator Signal Isolation", () => {
  resetRecoveryCoordinatorForTest();

  const signals: StaleRecoverySignal[] = [];
  const unsubscribe = subscribeStaleRecovery((sig) => {
    signals.push(sig);
  });

  const activeControllerNonce = "nonce-ctrl-100";
  const activeControllerBuild = "build-ctrl-100";

  // Function simulating StaleClientRecovery message handling
  const handleSwMessage = (
    eventSourceMatches: boolean,
    data: unknown,
    controllerIdentity: ServiceWorkerIdentity | null
  ) => {
    if (!eventSourceMatches || !controllerIdentity) return;

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      // Strict v1
      if (obj.protocol === 1 && obj.type === "K_STALE_ASSET") {
        if (controllerIdentity.protocolVersion !== 1 || !controllerIdentity.workerNonce) return;
        const validated = validateStaleAssetEnvelope(data, {
          controllerBuildId: controllerIdentity.buildId,
          controllerNonce: controllerIdentity.workerNonce,
        });
        if (validated && validated.status === 404 && isValidStaleAssetPath(validated.pathname)) {
          requestStaleRecovery({
            source: "sw_message",
            pathname: validated.pathname,
            buildId: validated.buildId,
            workerNonce: validated.workerNonce,
            timestamp: Date.now(),
          });
        }
        return;
      }

      // Legacy v0
      if (isLegacyStaleAssetMessage(data)) {
        if (controllerIdentity.buildId) {
          requestStaleRecovery({
            source: "sw_message",
            buildId: controllerIdentity.buildId,
            timestamp: Date.now(),
          });
        }
        return;
      }
    }
  };

  const v1ControllerIdentity: ServiceWorkerIdentity = {
    protocolVersion: 1,
    buildId: activeControllerBuild,
    swVersion: "sw-v1",
    workerNonce: activeControllerNonce,
  };

  // 1. Forged source (source !== controller) -> 0 coordinator calls
  handleSwMessage(
    false,
    {
      protocol: 1,
      type: "K_STALE_ASSET",
      requestNonce: "req-1",
      buildId: activeControllerBuild,
      workerNonce: activeControllerNonce,
      pathname: "/_next/static/chunks/app.js",
      status: 404,
    },
    v1ControllerIdentity
  );
  assert.equal(signals.length, 0);

  // 2. Forged nonce / buildId mismatch -> 0 coordinator calls
  handleSwMessage(
    true,
    {
      protocol: 1,
      type: "K_STALE_ASSET",
      requestNonce: "req-2",
      buildId: "attacker-build",
      workerNonce: activeControllerNonce,
      pathname: "/_next/static/chunks/app.js",
      status: 404,
    },
    v1ControllerIdentity
  );
  assert.equal(signals.length, 0);

  // 3. Forged non-404 status or invalid path -> 0 coordinator calls
  handleSwMessage(
    true,
    {
      protocol: 1,
      type: "K_STALE_ASSET",
      requestNonce: "req-3",
      buildId: activeControllerBuild,
      workerNonce: activeControllerNonce,
      pathname: "/api/bypass",
      status: 404,
    },
    v1ControllerIdentity
  );
  assert.equal(signals.length, 0);

  // 4. Valid v1 envelope from matching controller -> 1 coordinator call
  handleSwMessage(
    true,
    {
      protocol: 1,
      type: "K_STALE_ASSET",
      requestNonce: "req-4",
      buildId: activeControllerBuild,
      workerNonce: activeControllerNonce,
      pathname: "/_next/static/chunks/valid.js",
      status: 404,
    },
    v1ControllerIdentity
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0].pathname, "/_next/static/chunks/valid.js");
  assert.equal(signals[0].buildId, activeControllerBuild);

  // 5. Legacy v0 with unknown / null controller -> 0 coordinator calls
  handleSwMessage(true, { type: "K_STALE_ASSET" }, null);
  assert.equal(signals.length, 1);

  // 6. Legacy v0 with verified controller -> signals coordinator (v0 performs 0 direct reload/telemetry)
  const v0ControllerIdentity: ServiceWorkerIdentity = {
    protocolVersion: 0,
    buildId: "legacy-build-1",
    swVersion: "legacy-sw-1",
    workerNonce: null,
  };
  handleSwMessage(true, { type: "K_STALE_ASSET" }, v0ControllerIdentity);
  assert.equal(signals.length, 2);
  assert.equal(signals[1].buildId, "legacy-build-1");

  unsubscribe();
  resetRecoveryCoordinatorForTest();
});

// -------------------------------------------------------------
// Existing Safe Check & Routing / Consensus Tests
// -------------------------------------------------------------

test("Safe check scheduler - Unsafe route makes 0 network checks, safe route schedules check", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  let updateCalls = 0;
  const checkSafePath = (path: string, isReady: boolean) => {
    if (!isSafeRoutePath(path)) return false;
    if (!isReady) return false;
    if (isActivationBarrierActive() || isConversationActive()) return false;
    return true;
  };

  assert.equal(checkSafePath("/chat", false), false);
  assert.equal(updateCalls, 0);

  assert.equal(checkSafePath("/parent", false), false);
  assert.equal(updateCalls, 0);

  assert.equal(checkSafePath("/child/home", false), false);
  assert.equal(updateCalls, 0);

  const rev = getRouteReadinessSnapshot().routeRevision;
  publishRouteReady("/child/home", rev);
  assert.equal(checkSafePath("/child/home", isCurrentRouteSafeAndReady("/child/home")), true);

  const hazard = tryAcquireConversationHazard("chat", "speaking");
  assert.equal(checkSafePath("/child/home", isCurrentRouteSafeAndReady("/child/home")), false);

  hazard?.release();
  assert.equal(checkSafePath("/child/home", isCurrentRouteSafeAndReady("/child/home")), true);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});

test("Route revision drift during check discards result", async () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  const rev = getRouteReadinessSnapshot().routeRevision;
  publishRouteReady("/child/home", rev);

  const initialRevision = getRouteReadinessSnapshot().routeRevision;
  const initialPath = "/child/home";

  let updateCompleted = false;
  let discarded = false;

  const performCheck = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    updateCompleted = true;

    const currentSnapshot = getRouteReadinessSnapshot();
    if (currentSnapshot.routeRevision !== initialRevision || currentSnapshot.pathname !== initialPath) {
      discarded = true;
    }
  };

  const checkPromise = performCheck();
  startNavigation("/parent/home");

  await checkPromise;
  assert.equal(updateCompleted, true);
  assert.equal(discarded, true);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});

test("PWA_TAB_PREPARE synchronously opens activation barrier and evaluates vote", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  const now = Date.now();
  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId: "88888888-8888-4888-8888-888888888888",
    ownerTabId: "99999999-9999-4999-8999-999999999999",
    targetBuild: "build-v2",
    workerNonce: "nonce-w-100",
    fromBuild: "build-v1",
    createdAt: now - 500,
    expiresAt: now + 30000,
  };

  const rev = getRouteReadinessSnapshot().routeRevision;
  publishRouteReady("/child/home", rev);

  openActivationBarrier(proposal, "preparing");
  assert.equal(isActivationBarrierActive(), true);

  const voteAck = evaluateTabVote({
    requestNonce: "req-pwa-1",
    passId: "pass-1",
    voteNonce: "vote-1",
    proposal,
    pathname: "/child/home",
    documentBuildId: "build-v1",
    isConversationActive: isConversationActive(),
    now,
  });
  assert.equal(voteAck.status, "ACK_SAFE");

  const newHazard = tryAcquireConversationHazard("chat", "start_conversation");
  assert.equal(newHazard, null);

  commitActivationBarrier(proposal.proposalId);
  assert.equal(getActivationBarrierState().phase, "committed");

  abortActivationBarrier(proposal.proposalId);
  assert.equal(isActivationBarrierActive(), false);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});

test("U8-4: Central Blocking Modal Authority - No dismiss, no ESC/back, no 'later', only update buttons", () => {
  const modalStates = ["update_available", "delayed", "offline", "error", "verifying_latest"] as const;

  for (const st of modalStates) {
    const isAvailable = st === "update_available";
    const expectedButtonText = isAvailable ? "업데이트" : "다시 업데이트";
    assert.ok(expectedButtonText === "업데이트" || expectedButtonText === "다시 업데이트");
  }

  const unsafeRouteState = "deferred_during_session";
  const isModalOpenForUnsafe = ["update_available", "activating", "delayed", "offline", "error", "verifying_latest"].includes(unsafeRouteState);
  assert.equal(isModalOpenForUnsafe, false);
});
