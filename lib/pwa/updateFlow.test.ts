import test from "node:test";
import assert from "node:assert/strict";
import {
  PWA_ACTIVATION_DELAY_MS,
  PWA_DISMISS_COOLDOWN_MS,
  canDismissPwaModal,
  decideUpdateWorkerAction,
  isPwaDismissCooldownActive,
  pwaUpdateCopy,
  performRegistrationUpdate,
  parseReloadPendingMarker,
  saveReloadPendingMarker,
  getReloadPendingMarker,
  clearReloadPendingMarker,
  verifyLatestHandshake,
  ReloadPendingMarkerV3,
} from "./updateFlow";
import { LatestVersionMetadataV1 } from "./clientVersion";
import { DocumentDeploymentMarkerV1 } from "./documentDeployment";
import { ServiceWorkerIdentity } from "./swProtocol";

test("3초는 hard error가 아니고 activation 지연 기준은 8초다", () => {
  assert.equal(PWA_ACTIVATION_DELAY_MS, 8_000);
});

test("실제 waiting worker만 SKIP_WAITING 메시지 대상으로 선택한다", () => {
  assert.equal(
    decideUpdateWorkerAction({ waitingState: "installed" }),
    "message_waiting",
  );
  assert.equal(
    decideUpdateWorkerAction({ rememberedState: "installed" }),
    "message_waiting",
  );
});

test("installing/activating worker에는 SKIP_WAITING을 반복하지 않는다", () => {
  assert.equal(
    decideUpdateWorkerAction({ installingState: "installing" }),
    "wait_for_transition",
  );
  assert.equal(
    decideUpdateWorkerAction({ rememberedState: "activating" }),
    "wait_for_transition",
  );
});

test("activated/redundant stale 참조는 registration 재확인 대상으로 돌린다", () => {
  assert.equal(
    decideUpdateWorkerAction({ rememberedState: "activated" }),
    "refresh_registration",
  );
  assert.equal(
    decideUpdateWorkerAction({ rememberedState: "redundant" }),
    "refresh_registration",
  );
});

test("동일 build dismiss는 10분 동안만 유효하다", () => {
  const now = 1_000_000;
  assert.equal(
    isPwaDismissCooldownActive(now - PWA_DISMISS_COOLDOWN_MS + 1, now),
    true,
  );
  assert.equal(
    isPwaDismissCooldownActive(now - PWA_DISMISS_COOLDOWN_MS, now),
    false,
  );
});

test("offline·activation 지연·update 실패 문구를 구분하고 현재 버전 사용 가능을 알린다", () => {
  assert.match(pwaUpdateCopy("offline").title, /인터넷 연결/);
  assert.match(pwaUpdateCopy("delayed").title, /조금 늦어지고/);
  assert.match(pwaUpdateCopy("error").title, /확인하지 못했/);
  for (const state of ["offline", "delayed", "error"] as const) {
    assert.match(pwaUpdateCopy(state).body, /현재 버전은 계속 사용할 수/);
  }
});

test("canDismissPwaModal - offline·delayed·error 세 상태에서만 닫기 허용되고 update_available 등은 불허된다", () => {
  assert.equal(canDismissPwaModal("offline"), true);
  assert.equal(canDismissPwaModal("delayed"), true);
  assert.equal(canDismissPwaModal("error"), true);

  assert.equal(canDismissPwaModal("update_available"), false);
  assert.equal(canDismissPwaModal("checking"), false);
  assert.equal(canDismissPwaModal("activating"), false);
  assert.equal(canDismissPwaModal("verifying_latest"), false);
  assert.equal(canDismissPwaModal("idle"), false);
  assert.equal(canDismissPwaModal("up_to_date"), false);
  assert.equal(canDismissPwaModal("deferred_during_session"), false);
  assert.equal(canDismissPwaModal("reloading"), false);
});

// -------------------------------------------------------------
// Explicit Registration Update & Target Verification Tests
// -------------------------------------------------------------

const targetMetadataA: LatestVersionMetadataV1 = {
  schemaVersion: 1,
  buildId: "build-v2",
  buildStamp: "stamp-v2",
  deploymentId: "dpl-v2",
  swVersion: "sw-v2",
  serviceWorkerScriptUrl: "/sw.js",
};

test("performRegistrationUpdate - Missing or invalid targetSnapshot returns invalid-target and calls update() 0 times", async () => {
  let updateCalled = false;
  const mockReg = {
    update: async () => {
      updateCalled = true;
    },
  } as unknown as ServiceWorkerRegistration;

  // 1. Missing targetSnapshot
  const res1 = await performRegistrationUpdate({
    registration: mockReg,
  });
  assert.equal(res1.result, "invalid-target");
  assert.equal(updateCalled, false, "registration.update() must NOT be called without target");

  // 2. Invalid targetSnapshot (schemaVersion missing or empty fields)
  const res2 = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: { ...targetMetadataA, buildId: "" },
  });
  assert.equal(res2.result, "invalid-target");
  assert.equal(updateCalled, false, "registration.update() must NOT be called with invalid target");

  const res3 = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: {
      schemaVersion: 1,
      buildId: "partial",
    } as unknown as LatestVersionMetadataV1,
  });
  assert.equal(res3.result, "invalid-target");
  assert.equal(updateCalled, false, "registration.update() must NOT be called with a partial target");
});

test("performRegistrationUpdate - Network error is never swallowed and returns network-error", async () => {
  const mockReg = {
    update: async () => {
      throw new Error("Failed to fetch /sw.js");
    },
    waiting: null,
    installing: null,
  } as unknown as ServiceWorkerRegistration;

  const result = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
  });

  assert.equal(result.result, "network-error");
});

test("performRegistrationUpdate - Returns no-update when neither waiting nor installing worker exists", async () => {
  const mockReg = {
    update: async () => {},
    waiting: null,
    installing: null,
  } as unknown as ServiceWorkerRegistration;

  const result = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
  });

  assert.equal(result.result, "no-update");
});

function createIdentityWorker(input: {
  buildId: string;
  swVersion: string;
  workerNonce: string;
  scriptURL?: string;
}): ServiceWorker {
  return {
    state: "installed",
    scriptURL: input.scriptURL ?? "https://app.k-bestie.com/sw.js",
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (!message || typeof message !== "object") return;
      const requestNonce = (message as Record<string, unknown>).requestNonce;
      const responsePort = transfer?.[0];
      if (typeof requestNonce !== "string" || !(responsePort instanceof MessagePort)) return;
      responsePort.postMessage({
        protocol: 1,
        type: "PWA_IDENTITY_RESPONSE",
        requestNonce,
        buildId: input.buildId,
        swVersion: input.swVersion,
        workerNonce: input.workerNonce,
      });
    },
  } as unknown as ServiceWorker;
}

test("performRegistrationUpdate - returns the exact immutable snapshot with exact waiting worker identity", async () => {
  const mutableTarget = { ...targetMetadataA };
  const waiting = createIdentityWorker({
    buildId: targetMetadataA.buildId,
    swVersion: targetMetadataA.swVersion,
    workerNonce: "nonce-v2",
  });
  const registration = {
    waiting,
    installing: null,
    update: async () => {
      mutableTarget.buildId = "mutated-after-call";
      mutableTarget.deploymentId = "mutated-deployment";
    },
  } as unknown as ServiceWorkerRegistration;

  const outcome = await performRegistrationUpdate({
    registration,
    targetSnapshot: mutableTarget,
  });

  assert.equal(outcome.result, "installed-target");
  assert.equal(outcome.worker, waiting);
  assert.deepEqual(outcome.targetSnapshot, targetMetadataA);
  assert.equal(Object.isFrozen(outcome.targetSnapshot), true);
});

test("performRegistrationUpdate - rejects an exact worker whose runtime nonce is empty", async () => {
  const waiting = createIdentityWorker({
    buildId: targetMetadataA.buildId,
    swVersion: targetMetadataA.swVersion,
    workerNonce: " ",
  });
  const registration = {
    waiting,
    installing: null,
    update: async () => {},
  } as unknown as ServiceWorkerRegistration;

  const outcome = await performRegistrationUpdate({
    registration,
    targetSnapshot: targetMetadataA,
  });
  assert.equal(outcome.result, "identity-mismatch");
  assert.equal(outcome.targetSnapshot, undefined);
});

test("performRegistrationUpdate - rejects wrong waiting script and identity without returning a target snapshot", async () => {
  const wrongScriptWorker = createIdentityWorker({
    buildId: targetMetadataA.buildId,
    swVersion: targetMetadataA.swVersion,
    workerNonce: "nonce-valid",
    scriptURL: "https://app.k-bestie.com/not-sw.js",
  });
  const wrongScript = await performRegistrationUpdate({
    registration: {
      waiting: wrongScriptWorker,
      installing: null,
      update: async () => {},
    } as unknown as ServiceWorkerRegistration,
    targetSnapshot: targetMetadataA,
  });
  assert.equal(wrongScript.result, "identity-mismatch");
  assert.equal(wrongScript.targetSnapshot, undefined);

  const wrongIdentityWorker = createIdentityWorker({
    buildId: "wrong-build",
    swVersion: targetMetadataA.swVersion,
    workerNonce: "nonce-valid",
  });
  const wrongIdentity = await performRegistrationUpdate({
    registration: {
      waiting: wrongIdentityWorker,
      installing: null,
      update: async () => {},
    } as unknown as ServiceWorkerRegistration,
    targetSnapshot: targetMetadataA,
  });
  assert.equal(wrongIdentity.result, "identity-mismatch");
  assert.equal(wrongIdentity.targetSnapshot, undefined);
});

test("performRegistrationUpdate - Returns redundant when installing worker fails during install", async () => {
  const listeners: Record<string, () => void> = {};
  const mockInstalling: {
    state: ServiceWorkerState;
    scriptURL: string;
    addEventListener: (event: string, cb: () => void) => void;
    removeEventListener: (event: string) => void;
  } = {
    state: "installing",
    scriptURL: "https://app.k-bestie.com/sw.js",
    addEventListener: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
    removeEventListener: (event: string) => {
      delete listeners[event];
    },
  };

  const mockReg = {
    update: async () => {
      setTimeout(() => {
        mockInstalling.state = "redundant";
        listeners["statechange"]?.();
      }, 10);
    },
    waiting: null,
    installing: mockInstalling,
  } as unknown as ServiceWorkerRegistration;

  const result = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
    installTimeoutMs: 500,
  });

  assert.equal(result.result, "redundant");
});

test("performRegistrationUpdate - Returns install-timeout when installing worker does not settle", async () => {
  const mockInstalling: {
    state: ServiceWorkerState;
    scriptURL: string;
    addEventListener: (event: string, cb: () => void) => void;
    removeEventListener: (event: string) => void;
  } = {
    state: "installing",
    scriptURL: "https://app.k-bestie.com/sw.js",
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const mockReg = {
    update: async () => {},
    waiting: null,
    installing: mockInstalling,
  } as unknown as ServiceWorkerRegistration;

  const result = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
    installTimeoutMs: 50,
  });

  assert.equal(result.result, "install-timeout");
});

test("performRegistrationUpdate - Returns target-replaced when waiting is not the exact installing target", async () => {
  const listeners: Record<string, () => void> = {};
  const mockInstalling = {
    state: "installing",
    scriptURL: "https://app.k-bestie.com/sw.js",
    addEventListener: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
    removeEventListener: (event: string) => {
      delete listeners[event];
    },
  };
  const otherWaiting = {
    state: "installed",
    scriptURL: "https://app.k-bestie.com/sw.js",
  };

  const mockReg: {
    update: () => Promise<void>;
    waiting: typeof otherWaiting | null;
    installing: typeof mockInstalling;
  } = {
    update: async () => {
      setTimeout(() => {
        mockInstalling.state = "installed";
        mockReg.waiting = otherWaiting; // Different object!
        listeners["statechange"]?.();
      }, 10);
    },
    waiting: null,
    installing: mockInstalling,
  } as unknown as ServiceWorkerRegistration;

  const result = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
    installTimeoutMs: 500,
  });

  assert.equal(result.result, "target-replaced");
});

test("performRegistrationUpdate - Settles when registration.waiting assignment lags installingTarget installed state", async () => {
  const listeners: Record<string, () => void> = {};
  const mockInstalling = {
    state: "installing",
    scriptURL: "https://app.k-bestie.com/sw.js",
    addEventListener: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
    removeEventListener: (event: string) => {
      delete listeners[event];
    },
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (!message || typeof message !== "object") return;
      const requestNonce = (message as Record<string, unknown>).requestNonce;
      const responsePort = transfer?.[0];
      if (typeof requestNonce !== "string" || !(responsePort instanceof MessagePort)) return;
      responsePort.postMessage({
        protocol: 1,
        type: "PWA_IDENTITY_RESPONSE",
        requestNonce,
        buildId: targetMetadataA.buildId,
        swVersion: targetMetadataA.swVersion,
        workerNonce: "nonce-delayed-settle",
      });
    },
  };

  const mockReg: {
    update: () => Promise<void>;
    waiting: typeof mockInstalling | null;
    installing: typeof mockInstalling;
  } = {
    update: async () => {
      setTimeout(() => {
        // State changes to installed first, but registration.waiting is initially null
        mockInstalling.state = "installed";
        listeners["statechange"]?.();

        // registration.waiting assignment lags by 25ms (e.g. Safari / microtask lag)
        setTimeout(() => {
          mockReg.waiting = mockInstalling;
        }, 25);
      }, 10);
    },
    waiting: null,
    installing: mockInstalling,
  } as unknown as ServiceWorkerRegistration;

  const outcome = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
    installTimeoutMs: 500,
  });

  assert.equal(outcome.result, "installed-target");
  assert.equal(outcome.worker, mockInstalling as unknown as ServiceWorker);
  assert.equal(outcome.identity?.protocolVersion, 1);
  assert.equal(outcome.identity?.buildId, targetMetadataA.buildId);
  assert.equal(outcome.identity?.workerNonce, "nonce-delayed-settle");
});

test("performRegistrationUpdate - returns target-replaced when waiting worker is replaced during identity await", async () => {
  const waitingWorker1 = {
    state: "installed",
    scriptURL: "https://app.k-bestie.com/sw.js",
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      const requestNonce = (message as Record<string, unknown>).requestNonce;
      const responsePort = transfer?.[0] as MessagePort;
      // Before responding, worker is replaced in registration.waiting:
      mockReg.waiting = waitingWorker2 as unknown as ServiceWorker;
      setTimeout(() => {
        responsePort.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce,
          buildId: targetMetadataA.buildId,
          swVersion: targetMetadataA.swVersion,
          workerNonce: "nonce-replaced-1",
        });
      }, 10);
    },
  } as unknown as ServiceWorker;

  const waitingWorker2 = {
    state: "installed",
    scriptURL: "https://app.k-bestie.com/sw.js",
  };

  const mockReg = {
    waiting: waitingWorker1,
    installing: null,
    update: async () => {},
  } as unknown as ServiceWorkerRegistration;

  const outcome = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
  });

  assert.equal(outcome.result, "target-replaced");
});

test("performRegistrationUpdate - returns target-replaced when worker transitions to redundant during identity await", async () => {
  const mockWorker: {
    state: ServiceWorkerState;
    scriptURL: string;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
  } = {
    state: "installed",
    scriptURL: "https://app.k-bestie.com/sw.js",
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      const requestNonce = (message as Record<string, unknown>).requestNonce;
      const responsePort = transfer?.[0] as MessagePort;
      // Worker state changes to redundant while waiting for identity
      mockWorker.state = "redundant";
      setTimeout(() => {
        responsePort.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce,
          buildId: targetMetadataA.buildId,
          swVersion: targetMetadataA.swVersion,
          workerNonce: "nonce-redundant-1",
        });
      }, 10);
    },
  };

  const mockReg = {
    waiting: mockWorker as unknown as ServiceWorker,
    installing: null,
    update: async () => {},
  } as unknown as ServiceWorkerRegistration;

  const outcome = await performRegistrationUpdate({
    registration: mockReg,
    targetSnapshot: targetMetadataA,
  });

  assert.equal(outcome.result, "target-replaced");
});

// -------------------------------------------------------------
// Strict Marker Schema v3 Tests
// -------------------------------------------------------------

test("parseReloadPendingMarker - Validates complete schema v3 and strict UUIDs", () => {
  const now = 1_000_000;
  const validMarker: ReloadPendingMarkerV3 = {
    schemaVersion: 3,
    proposalId: "11111111-1111-4111-8111-111111111111",
    target: {
      schemaVersion: 1,
      buildId: "build-2026-08-15.1",
      buildStamp: "stamp-2026-08-15.1",
      deploymentId: "dpl_abc123",
      swVersion: "kbestie-shell-2026-08-15.1",
      serviceWorkerScriptUrl: "/sw.js",
    },
    activationWorkerNonce: "worker-nonce-99",
    successEventId: "22222222-2222-4222-8222-222222222222",
    documentBuildStampBeforeReload: "stamp-2026-08-14.2",
    startedAt: now - 5000,
    expiresAt: now + 55000,
    reason: "user_update",
  };

  assert.deepEqual(parseReloadPendingMarker(validMarker, now), validMarker);

  // JSON string parsing
  assert.deepEqual(
    parseReloadPendingMarker(JSON.stringify(validMarker), now),
    validMarker,
  );

  // Expired marker rejected
  assert.equal(parseReloadPendingMarker(validMarker, now + 60000), null);

  // Non-UUID proposalId or successEventId rejected (No Date.now fallback IDs!)
  assert.equal(
    parseReloadPendingMarker(
      { ...validMarker, proposalId: `prop_${Date.now()}` },
      now,
    ),
    null,
  );
  assert.equal(
    parseReloadPendingMarker(
      { ...validMarker, successEventId: `verify_${Date.now()}` },
      now,
    ),
    null,
  );

  // Schema v1 and v2 rejected strictly
  assert.equal(
    parseReloadPendingMarker({ ...validMarker, schemaVersion: 2 }, now),
    null,
  );
  assert.equal(
    parseReloadPendingMarker({ ...validMarker, schemaVersion: 1 }, now),
    null,
  );

  // Unknown keys rejected
  assert.equal(
    parseReloadPendingMarker({ ...validMarker, unknownKey: "attack" }, now),
    null,
  );

  // Missing required fields rejected
  assert.equal(
    parseReloadPendingMarker(
      { ...validMarker, target: { ...validMarker.target, deploymentId: "" } },
      now,
    ),
    null,
  );
});

test("saveReloadPendingMarker & getReloadPendingMarker - storage failure prevents reload and legacy markers are quarantined", () => {
  const now = 1_000_000;
  const validMarker: ReloadPendingMarkerV3 = {
    schemaVersion: 3,
    proposalId: "33333333-3333-4333-8333-333333333333",
    target: {
      schemaVersion: 1,
      buildId: "build-v2",
      buildStamp: "stamp-v2",
      deploymentId: "dpl-v2",
      swVersion: "sw-v2",
      serviceWorkerScriptUrl: "/sw.js",
    },
    activationWorkerNonce: "nonce-123",
    successEventId: "44444444-4444-4444-8444-444444444444",
    documentBuildStampBeforeReload: "stamp-v1",
    startedAt: now,
    expiresAt: now + 60000,
    reason: "stale_asset_recovery",
  };

  // Mock working storage
  const mockStore = new Map<string, string>();
  const workingStorage = {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: (k: string) => {
      mockStore.delete(k);
    },
  } as unknown as Storage;

  // Pre-seed legacy markers in storage
  mockStore.set("k_pwa_reload_pending_v2", "legacy_data_v2");
  mockStore.set("k_pwa_reload_pending_v1", "legacy_data_v1");

  assert.equal(saveReloadPendingMarker(validMarker, workingStorage), true);
  assert.deepEqual(getReloadPendingMarker(workingStorage, now), validMarker);

  // Legacy keys were deleted by getReloadPendingMarker
  assert.equal(mockStore.has("k_pwa_reload_pending_v2"), false);
  assert.equal(mockStore.has("k_pwa_reload_pending_v1"), false);

  clearReloadPendingMarker(workingStorage);
  assert.equal(getReloadPendingMarker(workingStorage, now), null);

  // Mock broken storage (e.g. QuotaExceededError or security block)
  const brokenStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  } as unknown as Storage;

  assert.equal(saveReloadPendingMarker(validMarker, brokenStorage), false);
});

// -------------------------------------------------------------
// Post-Reload Durable Identity & Latest Handshake Verification Tests
// -------------------------------------------------------------

test("verifyLatestHandshake - Success requires exact match across server, document and controller v1", () => {
  const marker: ReloadPendingMarkerV3 = {
    schemaVersion: 3,
    proposalId: "55555555-5555-4555-8555-555555555555",
    target: {
      schemaVersion: 1,
      buildId: "build-v2",
      buildStamp: "stamp-v2",
      deploymentId: "dpl_v2",
      swVersion: "sw-v2",
      serviceWorkerScriptUrl: "/sw.js",
    },
    activationWorkerNonce: "pre-reload-nonce",
    successEventId: "66666666-6666-4666-8666-666666666666",
    documentBuildStampBeforeReload: "stamp-v1",
    startedAt: 1000,
    expiresAt: 61000,
    reason: "user_update",
  };

  const serverMetadata: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-v2",
    buildStamp: "stamp-v2",
    deploymentId: "dpl_v2",
    swVersion: "sw-v2",
    serviceWorkerScriptUrl: "/sw.js",
  };

  const documentMarker: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-v2",
    buildStamp: "stamp-v2",
    deploymentId: "dpl_v2",
  };

  const controllerIdentity: ServiceWorkerIdentity = {
    protocolVersion: 1,
    buildId: "build-v2",
    swVersion: "sw-v2",
    workerNonce: "fresh-runtime-nonce-different", // Runtime nonce can differ after worker restart!
  };

  // 1. Exact match across all layers succeeds
  const successResult = verifyLatestHandshake({
    marker,
    serverMetadata,
    documentMarker,
    controllerIdentity,
    controllerScriptUrl: "https://app.k-bestie.com/sw.js",
  });
  assert.equal(successResult.ok, true);
  assert.equal(successResult.status, "success");

  // 2. Server fetch error -> network_error
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata: null,
      serverFetchError: true,
      documentMarker,
      controllerIdentity,
    }).status,
    "network_error",
  );

  // 3. Malformed server metadata -> malformed
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata: { ...serverMetadata, buildId: "" },
      documentMarker,
      controllerIdentity,
    }).status,
    "malformed",
  );

  // 4. Missing controller -> no_controller
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata,
      documentMarker,
      controllerIdentity: null,
    }).status,
    "no_controller",
  );

  // 5. Legacy controller (protocol 0) -> legacy_controller
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata,
      documentMarker,
      controllerIdentity: { ...controllerIdentity, protocolVersion: 0 },
    }).status,
    "legacy_controller",
  );

  // 6. Server newer -> server_newer (never silently accept)
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata: { ...serverMetadata, buildId: "build-v3" },
      documentMarker,
      controllerIdentity,
    }).status,
    "server_newer",
  );

  // 7. Document stamp mismatch -> mismatch
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata,
      documentMarker: { ...documentMarker, buildStamp: "stamp-old" },
      controllerIdentity,
    }).status,
    "mismatch",
  );

  // 8. Controller scriptURL mismatch -> mismatch
  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata,
      documentMarker,
      controllerIdentity,
      controllerScriptUrl: "/foreign-sw.js",
    }).status,
    "mismatch",
  );

  const serverFieldMismatches: LatestVersionMetadataV1[] = [
    { ...serverMetadata, buildStamp: "stamp-v3" },
    { ...serverMetadata, deploymentId: "dpl_v3" },
    { ...serverMetadata, swVersion: "sw-v3" },
    { ...serverMetadata, serviceWorkerScriptUrl: "/sw-v3.js" },
  ];
  for (const mismatchedServer of serverFieldMismatches) {
    const result = verifyLatestHandshake({
      marker,
      serverMetadata: mismatchedServer,
      documentMarker,
      controllerIdentity,
      controllerScriptUrl: "/sw.js",
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "mismatch");
  }

  const documentFieldMismatches: DocumentDeploymentMarkerV1[] = [
    { ...documentMarker, buildId: "build-old" },
    { ...documentMarker, buildStamp: "stamp-old" },
    { ...documentMarker, deploymentId: "dpl-old" },
  ];
  for (const mismatchedDocument of documentFieldMismatches) {
    assert.equal(
      verifyLatestHandshake({
        marker,
        serverMetadata,
        documentMarker: mismatchedDocument,
        controllerIdentity,
        controllerScriptUrl: "/sw.js",
      }).ok,
      false,
    );
  }

  for (const mismatchedController of [
    { ...controllerIdentity, buildId: "build-old" },
    { ...controllerIdentity, swVersion: "sw-old" },
    { ...controllerIdentity, workerNonce: "" },
  ] satisfies ServiceWorkerIdentity[]) {
    assert.equal(
      verifyLatestHandshake({
        marker,
        serverMetadata,
        documentMarker,
        controllerIdentity: mismatchedController,
        controllerScriptUrl: "/sw.js",
      }).ok,
      false,
    );
  }

  assert.equal(
    verifyLatestHandshake({
      marker,
      serverMetadata,
      documentMarker: null,
      controllerIdentity,
      controllerScriptUrl: "/sw.js",
    }).ok,
    false,
  );
});
