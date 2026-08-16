import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  EXACT_SAFE_ROUTES,
  isSafeRoute,
  publishRouteReady,
  revokeRouteReady,
  isExplicitRouteReady,
  getRouteRevision,
  incrementRouteRevision,
  isNavigationInFlight,
  setNavigationInFlight,
  _resetRouteReadinessStoreForTest,
} from "./routeReadiness";

describe("routeReadiness - Exact safe routes & explicit ready token", () => {
  beforeEach(() => {
    _resetRouteReadinessStoreForTest();
  });

  it("should match exact safe routes allowlist", () => {
    assert.equal(isSafeRoute("/"), true);
    assert.equal(isSafeRoute("/child/home"), true);
    assert.equal(isSafeRoute("/parent"), true);
    assert.equal(isSafeRoute("/parent/home"), true);
    assert.equal(isSafeRoute("/login"), true);
    assert.equal(isSafeRoute("/offline"), true);

    // Unsafe routes
    assert.equal(isSafeRoute("/parent/settings"), false);
    assert.equal(isSafeRoute("/child/missions"), false);
    assert.equal(isSafeRoute("/chat"), false);
  });

  it("should enforce explicit route readiness publishing", () => {
    assert.equal(isExplicitRouteReady("/child/home"), false);

    publishRouteReady("/child/home");
    assert.equal(isExplicitRouteReady("/child/home"), true);

    revokeRouteReady("/child/home");
    assert.equal(isExplicitRouteReady("/child/home"), false);
  });

  it("should maintain readiness=false for /parent because PwaSafeRouteReady is not mounted on /parent", () => {
    assert.equal(isSafeRoute("/parent"), true);
    assert.equal(isExplicitRouteReady("/parent"), false);
  });

  it("should invalidate readiness when route revision changes or navigation is in flight", () => {
    publishRouteReady("/parent/home", 0);
    assert.equal(isExplicitRouteReady("/parent/home", 0), true);

    incrementRouteRevision();
    assert.equal(isExplicitRouteReady("/parent/home", 0), false);
    assert.equal(isNavigationInFlight(), true);

    publishRouteReady("/parent/home", 1);
    assert.equal(isExplicitRouteReady("/parent/home", 1), true);
    assert.equal(isNavigationInFlight(), false);
  });
});
