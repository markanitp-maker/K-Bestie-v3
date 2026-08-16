import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST } from "./route";

describe("POST /api/analytics/pwa-update payload validation", () => {
  it("should reject non-json content type with 400", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_content_type");
  });

  it("should reject payload exceeding 4KB size limit with 400", async () => {
    const hugeMetadata = "a".repeat(5 * 1024);
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
        metadata: { sw_state: hugeMetadata },
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "payload_too_large");
  });

  it("should reject missing or invalid event_id with 400", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_event_id");
  });

  it("should reject invalid event type with 400", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "invalid_type",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_event_type");
  });

  it("should reject client-supplied identity fields with 400 unallowed_key", async () => {
    const identityFields = ["user_id", "actor_id", "child_id", "family_id", "actor_type", "session_id"];
    for (const field of identityFields) {
      const request = new Request("http://localhost/api/analytics/pwa-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: "550e8400-e29b-41d4-a716-446655440000",
          event_type: "pwa_update_check_started",
          correlation_id: "12345678-1234-4234-8234-1234567890ab",
          route: "/child/home",
          [field]: "injected-id",
        }),
      });

      const response = await POST(request);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.error, "unallowed_key");
    }
  });

  it("should reject non-whitelisted or arbitrary metadata key with 400 invalid_metadata", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
        metadata: { arbitrary_pii: "secret_value" },
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_metadata");
  });

  it("should reject out of range metadata values with 400 invalid_metadata", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
        metadata: { retry_count: 99 },
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_metadata");
  });

  it("should reject route with query string or hash with 400 invalid_route", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home?param=1",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_route");
  });

  it("should return 401 when valid payload is passed but user is unauthenticated", async () => {
    const request = new Request("http://localhost/api/analytics/pwa-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "550e8400-e29b-41d4-a716-446655440000",
        event_type: "pwa_update_check_started",
        correlation_id: "12345678-1234-4234-8234-1234567890ab",
        route: "/child/home",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "unauthorized");
  });
});
