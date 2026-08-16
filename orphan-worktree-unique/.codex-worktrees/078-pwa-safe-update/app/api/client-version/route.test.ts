import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET, POST } from "./route";

describe("GET /api/client-version", () => {
  it("should return buildId and extended metadata with no-store header", async () => {
    const response = await GET();

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Cache-Control"),
      "no-store, no-cache, must-revalidate",
    );

    const body = await response.json();
    assert.ok(typeof body.buildId === "string" && body.buildId.length > 0);
    assert.ok(typeof body.buildStamp === "string");
    assert.ok(typeof body.deploymentId === "string");
    assert.ok(typeof body.swVersion === "string");
    assert.ok(typeof body.serverTime === "number");
  });
});

describe("POST /api/client-version validation & security", () => {
  it("should reject payload > 2KB with 400 malformed", async () => {
    const largeValue = "x".repeat(2500);
    const request = new Request("http://localhost/api/client-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientSha: largeValue }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "malformed");
  });

  it("should reject spoofed childId in payload with 400 malformed", async () => {
    const request = new Request("http://localhost/api/client-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        childId: "spoofed-child-id",
        clientSha: "abc",
        swVersion: "1.0",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "malformed");
  });

  it("should reject non-UUID sessionId with 400 malformed", async () => {
    const request = new Request("http://localhost/api/client-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "not-a-uuid",
        clientSha: "abc",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "malformed");
  });

  it("should return 401 unauth when user is unauthenticated", async () => {
    const request = new Request("http://localhost/api/client-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSha: "abc",
        swVersion: "1.0",
      }),
    });

    const response = await POST(request);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "unauth");
  });
});
