import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_ROUTE_ALLOWLIST,
  isSafeRoutePath,
  normalizeRoutePath,
  publishRouteReady,
  revokeRouteReady,
  startNavigation,
  getRouteReadinessSnapshot,
  isCurrentRouteSafeAndReady,
  resetRouteReadinessForTest,
  initNavigationListeners,
} from "./routeReadiness";
import {
  tryAcquireConversationHazard,
  setConversationActivityReady,
  resetConversationActivityStateForTest,
} from "./conversationActivity";

test("Route Path Normalization & Safe Route Allowlist - Exact matches only, /parent & prefixes excluded", () => {
  assert.equal(normalizeRoutePath("/"), "/");
  assert.equal(normalizeRoutePath("/child/home/"), "/child/home");
  assert.equal(normalizeRoutePath("/child/home?param=123#hash"), "/child/home");
  assert.equal(normalizeRoutePath("  /login  "), "/login");

  // Exact safe allowlist
  assert.equal(isSafeRoutePath("/"), true);
  assert.equal(isSafeRoutePath("/child/home"), true);
  assert.equal(isSafeRoutePath("/parent/home"), true);
  assert.equal(isSafeRoutePath("/login"), true);
  assert.equal(isSafeRoutePath("/offline"), true);

  // Unsafe / redirect-only / prefix routes fail
  assert.equal(isSafeRoutePath("/parent"), false);
  assert.equal(isSafeRoutePath("/child/home/details"), false);
  assert.equal(isSafeRoutePath("/parent/home/settings"), false);
  assert.equal(isSafeRoutePath("/login/child"), false);
  assert.equal(isSafeRoutePath("/offline/fallback"), false);
  assert.equal(isSafeRoutePath("/chat"), false);
  assert.equal(isSafeRoutePath("/child/missions"), false);
  assert.equal(isSafeRoutePath("/child/play"), false);
  assert.equal(isSafeRoutePath("/parent/settings"), false);
  assert.equal(isSafeRoutePath("/signup"), false);
  assert.equal(isSafeRoutePath("/unknown/route"), false);
});

test("Route Readiness Lifecycle - Same-tick pathname/ready ordering, stale tokens, and revokes", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  // 1. Initial state (no token published yet)
  assert.equal(isCurrentRouteSafeAndReady("/"), false);

  // 2. Publish readiness on safe route "/"
  const snapshot1 = getRouteReadinessSnapshot();
  const token = publishRouteReady("/", snapshot1.routeRevision);
  assert.notEqual(token, null);
  assert.equal(isCurrentRouteSafeAndReady("/"), true);

  // 3. Publishing on unsafe route or /parent fails
  const unsafeToken = publishRouteReady("/chat", getRouteReadinessSnapshot().routeRevision);
  assert.equal(unsafeToken, null);

  const parentRedirectToken = publishRouteReady("/parent", getRouteReadinessSnapshot().routeRevision);
  assert.equal(parentRedirectToken, null);

  const prefixToken = publishRouteReady("/child/home/sub", getRouteReadinessSnapshot().routeRevision);
  assert.equal(prefixToken, null);

  // 4. Stale revision publication fails
  const staleToken = publishRouteReady("/", snapshot1.routeRevision - 1);
  assert.equal(staleToken, null);

  // 5. Start navigation increments revision and resets readiness synchronously
  const rev = startNavigation("/child/home");
  assert.ok(rev > snapshot1.routeRevision);
  assert.equal(getRouteReadinessSnapshot().isNavigationInFlight, true);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), false);

  // In the same tick, an old token publication attempt is rejected:
  const staleSameTickToken = publishRouteReady("/child/home", snapshot1.routeRevision);
  assert.equal(staleSameTickToken, null);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), false);

  // 6. When new route commits and publishes readiness with fresh revision
  const newRev = getRouteReadinessSnapshot().routeRevision;
  const childHomeToken = publishRouteReady("/child/home", newRev);
  assert.notEqual(childHomeToken, null);
  assert.equal(getRouteReadinessSnapshot().isNavigationInFlight, false);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), true);

  // 7. Stale revocation token does not revoke current active token
  revokeRouteReady("stale-fake-token");
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), true);

  // 8. Correct revocation revokes readiness
  revokeRouteReady(childHomeToken!);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), false);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});

test("Programmatic Navigation & History Invalidation - pushState and replaceState invalidate readiness before check", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  // Setup mock window with history
  const originalWindow = (globalThis as any).window;
  const historyCalls: string[] = [];
  const mockHistory = {
    state: null as any,
    pushState: (state: any, unused: string, url?: string | URL | null) => {
      mockHistory.state = state;
      if (url) historyCalls.push(url.toString());
    },
    replaceState: (state: any, unused: string, url?: string | URL | null) => {
      mockHistory.state = state;
      if (url) historyCalls.push(url.toString());
    },
  };

  (globalThis as any).window = {
    location: {
      pathname: "/",
      search: "",
      hash: "",
      href: "https://app.k-bestie.com/",
      origin: "https://app.k-bestie.com",
    },
    history: mockHistory,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  initNavigationListeners();

  // Publish readiness on "/"
  const initialRev = getRouteReadinessSnapshot().routeRevision;
  const rootToken = publishRouteReady("/", initialRev);
  assert.notEqual(rootToken, null);
  assert.equal(getRouteReadinessSnapshot().isRouteReady, true);

  // Programmatic pushState to /parent/home
  window.history.pushState(null, "", "/parent/home");
  const snapshotAfterPush = getRouteReadinessSnapshot();

  // Invalidation must happen synchronously!
  assert.ok(snapshotAfterPush.routeRevision > initialRev);
  assert.equal(snapshotAfterPush.isRouteReady, false);
  assert.equal(snapshotAfterPush.isNavigationInFlight, true);
  assert.equal(snapshotAfterPush.pathname, "/parent/home");

  // Programmatic replaceState to /child/home
  window.history.replaceState(null, "", "/child/home");
  const snapshotAfterReplace = getRouteReadinessSnapshot();
  assert.ok(snapshotAfterReplace.routeRevision > snapshotAfterPush.routeRevision);
  assert.equal(snapshotAfterReplace.isRouteReady, false);
  assert.equal(snapshotAfterReplace.pathname, "/child/home");

  // Cleanup
  resetRouteReadinessForTest();
  (globalThis as any).window = originalWindow;
});

test("isCurrentRouteSafeAndReady - Fails closed when conversation hazard active or activity not ready", () => {
  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();

  const rev = getRouteReadinessSnapshot().routeRevision;
  const token = publishRouteReady("/child/home", rev);
  assert.notEqual(token, null);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), true);

  // When activity not ready:
  setConversationActivityReady(false);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), false);
  setConversationActivityReady(true);
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), true);

  // When conversation hazard is active:
  const hazard = tryAcquireConversationHazard("chat", "testing_hazard");
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), false);

  // Releasing hazard restores safe readiness:
  hazard?.release();
  assert.equal(isCurrentRouteSafeAndReady("/child/home"), true);

  resetRouteReadinessForTest();
  resetConversationActivityStateForTest();
});
