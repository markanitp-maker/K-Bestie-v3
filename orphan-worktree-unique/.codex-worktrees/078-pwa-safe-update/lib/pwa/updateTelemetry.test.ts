import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PWA_UPDATE_EVENT_TYPES,
  getOrCreatePwaCorrelationId,
  isPwaUpdateEventType,
  sanitizeMetadata,
  sanitizeRoutePath,
  sendPwaUpdateTelemetry,
  UUID_REGEX,
} from "./updateTelemetry";

describe("updateTelemetry", () => {
  it("should validate all 13 whitelist event types and reject legacy/unknown event types", () => {
    assert.equal(PWA_UPDATE_EVENT_TYPES.length, 13);
    const expected13 = new Set([
      "pwa_update_check_started",
      "pwa_update_check_no_update",
      "pwa_update_available",
      "pwa_update_modal_shown",
      "pwa_update_clicked",
      "pwa_update_activation_started",
      "pwa_update_success",
      "pwa_update_failed",
      "pwa_update_gate_blocked_navigation",
      "pwa_stale_client_detected",
      "pwa_stale_client_recovery_started",
      "pwa_stale_client_recovery_success",
      "pwa_stale_client_recovery_failed",
    ]);

    for (const evt of PWA_UPDATE_EVENT_TYPES) {
      assert.equal(expected13.has(evt), true);
      assert.equal(isPwaUpdateEventType(evt), true);
    }

    const legacyNames = [
      "pwa_check_initiated",
      "pwa_check_completed",
      "pwa_check_failed",
      "pwa_mismatch_detected",
      "pwa_active_defer",
      "pwa_modal_shown",
      "pwa_sw_updating",
      "pwa_sw_updated",
      "pwa_controller_changed",
      "pwa_reload_triggered",
      "pwa_fatal_recovery",
    ];
    for (const legacy of legacyNames) {
      assert.equal(isPwaUpdateEventType(legacy), false, `Legacy event '${legacy}' must be 0`);
    }
  });

  it("should create or reuse valid UUID correlation ID from storage", () => {
    const mockStorage: Record<string, string> = {};
    const storageImpl = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
    };

    const id1 = getOrCreatePwaCorrelationId(storageImpl);
    assert.ok(typeof id1 === "string" && id1.length === 36);

    const id2 = getOrCreatePwaCorrelationId(storageImpl);
    assert.equal(id1, id2);

    mockStorage["k_pwa_update_correlation_id"] = "invalid-not-uuid";
    const id3 = getOrCreatePwaCorrelationId(storageImpl);
    assert.notEqual(id3, "invalid-not-uuid");
    assert.ok(id3.length === 36);
  });

  it("should sanitize route paths and metadata safely, stripping identity fields", () => {
    assert.equal(sanitizeRoutePath("/child/home?foo=bar#section"), "/child/home");
    assert.equal(sanitizeRoutePath("not-a-path"), "/");

    const meta = sanitizeMetadata({
      sw_state: "installed",
      retry_count: 2,
      user_id: "pii_user",
      actor_id: "actor_123",
      child_id: "child_456",
      secret: "hidden",
    });
    assert.deepEqual(meta, { sw_state: "installed", retry_count: 2 });
  });

  it("should send telemetry with required event_id UUID and reuse provided eventId", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const mockFetch: typeof fetch = async (_url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const customEventId = "550e8400-e29b-41d4-a716-446655440000";
    await sendPwaUpdateTelemetry({
      eventId: customEventId,
      eventType: "pwa_update_available",
      route: "/child/home",
      currentVersion: "v1.0.0",
      latestVersion: "v1.0.1",
      fetchImpl: mockFetch,
    });

    assert.ok(sentBody);
    assert.equal(sentBody.event_id, customEventId);
    assert.equal(sentBody.event_type, "pwa_update_available");
    assert.equal(sentBody.route, "/child/home");
    assert.ok(typeof sentBody.correlation_id === "string");
    assert.equal(UUID_REGEX.test(sentBody.event_id as string), true);
  });

  it("should send telemetry without throwing even if fetch fails (fail-open)", async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error("Network error");
    };

    await sendPwaUpdateTelemetry({
      eventType: "pwa_update_check_started",
      route: "/child/home",
      fetchImpl: failingFetch,
    });
  });
});
