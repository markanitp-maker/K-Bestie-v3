import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDeterministicEventId,
  isValidDeterministicEventId,
  PWA_TELEMETRY_DOMAIN,
} from "./deterministicEventId.js";

test("generateDeterministicEventId generates consistent UUIDv8 for identical inputs", () => {
  const actorId = "user-12345678-abcd-ef01-2345-6789abcdef01";
  const eventId = "e89b47e2-4161-4fa3-9f12-a5e22709e86a";

  const id1 = generateDeterministicEventId(actorId, eventId);
  const id2 = generateDeterministicEventId(actorId, eventId);

  assert.equal(id1, id2);
  assert.equal(typeof id1, "string");
  assert.equal(id1.length, 36);
  assert.equal(isValidDeterministicEventId(id1), true);

  // Version 8 check (14th char)
  assert.equal(id1[14], "8");

  // Variant check (19th char must be 8, 9, a, or b)
  assert.match(id1[19], /^[89ab]$/);
});

test("generateDeterministicEventId produces distinct UUIDs for different actors, events, or domains", () => {
  const actor1 = "user-11111111-1111-1111-1111-111111111111";
  const actor2 = "user-22222222-2222-2222-2222-222222222222";
  const event1 = "event-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const event2 = "event-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const id1 = generateDeterministicEventId(actor1, event1);
  const id2 = generateDeterministicEventId(actor2, event1);
  const id3 = generateDeterministicEventId(actor1, event2);
  const id4 = generateDeterministicEventId(actor1, event1, "custom:domain:v2");

  assert.notEqual(id1, id2);
  assert.notEqual(id1, id3);
  assert.notEqual(id1, id4);
  assert.notEqual(id2, id3);
  assert.notEqual(id2, id4);
  assert.notEqual(id3, id4);

  assert.equal(isValidDeterministicEventId(id1), true);
  assert.equal(isValidDeterministicEventId(id2), true);
  assert.equal(isValidDeterministicEventId(id3), true);
  assert.equal(isValidDeterministicEventId(id4), true);
});

test("generateDeterministicEventId fails closed on invalid inputs", () => {
  assert.throws(() => generateDeterministicEventId("", "event-1"), /actorId/);
  assert.throws(() => generateDeterministicEventId("   ", "event-1"), /actorId/);
  assert.throws(() => generateDeterministicEventId("actor-1", ""), /eventId/);
  assert.throws(() => generateDeterministicEventId("actor-1", "   "), /eventId/);
  assert.throws(
    () => generateDeterministicEventId("actor-1", "event-1", ""),
    /domain/,
  );
});

test("isValidDeterministicEventId validates RFC 4122 UUIDv8 structure", () => {
  assert.equal(
    isValidDeterministicEventId("12345678-1234-8234-8234-123456789abc"),
    true,
  );
  assert.equal(
    isValidDeterministicEventId("12345678-1234-8234-9234-123456789abc"),
    true,
  );
  assert.equal(
    isValidDeterministicEventId("12345678-1234-8234-a234-123456789abc"),
    true,
  );
  assert.equal(
    isValidDeterministicEventId("12345678-1234-8234-b234-123456789abc"),
    true,
  );

  // Invalid version (e.g. 4 instead of 8)
  assert.equal(
    isValidDeterministicEventId("12345678-1234-4234-8234-123456789abc"),
    false,
  );

  // Invalid variant (e.g. 4 instead of 8,9,a,b)
  assert.equal(
    isValidDeterministicEventId("12345678-1234-8234-4234-123456789abc"),
    false,
  );

  // Invalid format
  assert.equal(isValidDeterministicEventId("not-a-uuid"), false);
  assert.equal(isValidDeterministicEventId(""), false);
});
