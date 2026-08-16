import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UPDATE_CHECK_INTERVAL_MS,
  canReleaseGateOnNoUpdate,
  evaluateUpdateGateDecision,
  evaluateVersionMismatch,
  isRouteReady,
  isSafeRoute,
  performClientVersionCheck,
  shouldCheckForUpdate,
} from "./updateGate";

describe("isSafeRoute - Exact allowlist contract", () => {
  it("should return true ONLY for exact allowlist routes", () => {
    assert.equal(isSafeRoute("/"), true);
    assert.equal(isSafeRoute("/child/home"), true);
    assert.equal(isSafeRoute("/parent"), true);
    assert.equal(isSafeRoute("/parent/home"), true);
    assert.equal(isSafeRoute("/login"), true);
    assert.equal(isSafeRoute("/offline"), true);

    // With query params or hashes
    assert.equal(isSafeRoute("/child/home?tab=1"), true);
    assert.equal(isSafeRoute("/login#top"), true);
  });

  it("should return false for settings, onboarding, invitation, play, mission, chat, subpaths, and unknown routes (fail-closed)", () => {
    assert.equal(isSafeRoute("/settings"), false);
    assert.equal(isSafeRoute("/parent/settings"), false);
    assert.equal(isSafeRoute("/onboarding"), false);
    assert.equal(isSafeRoute("/invitation"), false);
    assert.equal(isSafeRoute("/play"), false);
    assert.equal(isSafeRoute("/child/play"), false);
    assert.equal(isSafeRoute("/child/missions"), false);
    assert.equal(isSafeRoute("/child/missions/123"), false);
    assert.equal(isSafeRoute("/chat"), false);
    assert.equal(isSafeRoute("/child/chat"), false);
    assert.equal(isSafeRoute("/child/chat/session1"), false);

    // Subpaths or unknown paths fail-closed
    assert.equal(isSafeRoute("/child/home/extra"), false);
    assert.equal(isSafeRoute("/unknown"), false);
    assert.equal(isSafeRoute(""), false);
  });
});

describe("isRouteReady - Exact route readiness contract", () => {
  it("should return true when all route readiness conditions are met", () => {
    assert.equal(
      isRouteReady({
        pathname: "/child/home",
        checkedRevision: "rev-1",
        currentRevision: "rev-1",
        isReactReady: true,
        isActivityReady: true,
        isNavigationInFlight: false,
      }),
      true,
    );
  });

  it("should return false if route is not safe", () => {
    assert.equal(
      isRouteReady({
        pathname: "/settings",
        isReactReady: true,
        isActivityReady: true,
        isNavigationInFlight: false,
      }),
      false,
    );
  });

  it("should return false if route revision mismatch", () => {
    assert.equal(
      isRouteReady({
        pathname: "/child/home",
        checkedRevision: "rev-1",
        currentRevision: "rev-2",
      }),
      false,
    );
  });

  it("should return false if React readiness not committed", () => {
    assert.equal(
      isRouteReady({
        pathname: "/child/home",
        isReactReady: false,
      }),
      false,
    );
  });

  it("should return false if activity store not ready", () => {
    assert.equal(
      isRouteReady({
        pathname: "/child/home",
        isActivityReady: false,
      }),
      false,
    );
  });

  it("should return false if navigation is in flight", () => {
    assert.equal(
      isRouteReady({
        pathname: "/child/home",
        isNavigationInFlight: true,
      }),
      false,
    );
  });
});

describe("evaluateUpdateGateDecision", () => {
  it("should defer update when conversation is active", () => {
    const decision = evaluateUpdateGateDecision({
      hasUpdate: true,
      pathname: "/child/home",
      isConversationActive: true,
      hasActivityStatePublished: true,
    });
    assert.equal(decision.shouldShowModal, false);
    assert.equal(decision.isDeferred, true);
  });

  it("should show modal on safe route when active is false and route is ready", () => {
    const decision = evaluateUpdateGateDecision({
      hasUpdate: true,
      pathname: "/child/home",
      isConversationActive: false,
      hasActivityStatePublished: true,
    });
    assert.equal(decision.shouldShowModal, true);
    assert.equal(decision.isDeferred, false);
  });

  it("should return false for modal and defer when there is no update", () => {
    const decision = evaluateUpdateGateDecision({
      hasUpdate: false,
      pathname: "/child/home",
      isConversationActive: false,
    });
    assert.equal(decision.shouldShowModal, false);
    assert.equal(decision.isDeferred, false);
  });
});

describe("canReleaseGateOnNoUpdate", () => {
  it("should allow release when no waiting or installing worker exists", () => {
    assert.equal(canReleaseGateOnNoUpdate(null), true);
    assert.equal(canReleaseGateOnNoUpdate({}), true);
  });

  it("should forbid release when waiting worker exists", () => {
    assert.equal(canReleaseGateOnNoUpdate({ waiting: {} }), false);
  });

  it("should forbid release when installing worker exists", () => {
    assert.equal(canReleaseGateOnNoUpdate({ installing: {} }), false);
  });
});

describe("shouldCheckForUpdate", () => {
  const clientLoadedAt = 1000000;

  it("should return true on initial check if route is safe", () => {
    assert.equal(
      shouldCheckForUpdate({
        clientLoadedAt,
        lastCheckedAt: null,
        currentTime: clientLoadedAt + 100,
        route: "/child/home",
        isInitialCheck: true,
      }),
      true,
    );
  });

  it("should return false on initial check if route is unsafe", () => {
    assert.equal(
      shouldCheckForUpdate({
        clientLoadedAt,
        lastCheckedAt: null,
        currentTime: clientLoadedAt + 100,
        route: "/settings",
        isInitialCheck: true,
      }),
      false,
    );
  });

  it("should calculate elapsed time from clientLoadedAt or lastCheckedAt", () => {
    const currentTime = clientLoadedAt + UPDATE_CHECK_INTERVAL_MS;
    assert.equal(
      shouldCheckForUpdate({
        clientLoadedAt,
        lastCheckedAt: null,
        currentTime,
        route: "/child/home",
      }),
      true,
    );
  });
});

describe("evaluateVersionMismatch", () => {
  it("should return no-update when build IDs match", () => {
    assert.equal(evaluateVersionMismatch("stamp-v1", "stamp-v1"), "no-update");
  });

  it("should return mismatch when build IDs differ", () => {
    assert.equal(evaluateVersionMismatch("stamp-v1", "stamp-v2"), "mismatch");
  });
});

describe("performClientVersionCheck - 4 explicit results contract", () => {
  it("should return no-update and validated metadata when server returns matching build", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          buildId: "v1.0.0",
          buildStamp: "v1.0.0",
          deploymentId: "dep-1",
          gitSha: "abc",
          swVersion: "v1.0.0",
          serverTime: Date.now(),
        }),
        { status: 200 },
      );

    const result = await performClientVersionCheck({
      currentVersion: "v1.0.0",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "no-update");
    assert.equal(result.currentVersion, "v1.0.0");
    assert.equal(result.latestVersion, "v1.0.0");
    assert.equal(result.metadata?.deploymentId, "dep-1");
  });

  it("should return mismatch and metadata when server returns different build", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          buildId: "v1.0.1",
          buildStamp: "v1.0.1",
          deploymentId: "dep-2",
        }),
        { status: 200 },
      );

    const result = await performClientVersionCheck({
      currentVersion: "v1.0.0",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "mismatch");
    assert.equal(result.latestVersion, "v1.0.1");
    assert.equal(result.metadata?.buildId, "v1.0.1");
  });

  it("should return invalid-response when response is malformed or missing buildId/buildStamp", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ gitSha: "123" }), { status: 200 });

    const result = await performClientVersionCheck({
      currentVersion: "v1.0.0",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "invalid-response");
    assert.equal(result.latestVersion, null);
    assert.equal(result.metadata, null);
    assert.equal(result.error, "INVALID_RESPONSE");
  });

  it("should return network-failure on HTTP errors", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    const result = await performClientVersionCheck({
      currentVersion: "v1.0.0",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "network-failure");
    assert.equal(result.latestVersion, null);
    assert.equal(result.metadata, null);
    assert.equal(result.error, "HTTP_500");
  });

  it("should return network-failure on network exception", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("Failed to fetch");
    };

    const result = await performClientVersionCheck({
      currentVersion: "v1.0.0",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "network-failure");
    assert.equal(result.latestVersion, null);
    assert.equal(result.error, "Failed to fetch");
  });
});
