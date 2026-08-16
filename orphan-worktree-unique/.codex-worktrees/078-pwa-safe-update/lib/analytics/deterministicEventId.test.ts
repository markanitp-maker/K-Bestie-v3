import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDeterministicEventId,
  isValidUuid,
} from "./deterministicEventId";

test("deterministicEventId - generates valid RFC4122 UUIDv8", () => {
  const actorId = "actor-user-123";
  const clientEventId = "550e8400-e29b-41d4-a716-446655440000";

  const uuid = generateDeterministicEventId(actorId, clientEventId);
  assert.equal(isValidUuid(uuid), true);

  const parts = uuid.split("-");
  assert.equal(parts.length, 5);
  // Version bit check: third segment starts with '8' (version 8)
  assert.equal(parts[2].startsWith("8"), true);
  // Variant bit check: fourth segment starts with '8', '9', 'a', or 'b'
  assert.ok(/^[89ab]/i.test(parts[3]));
});

test("deterministicEventId - idempotency: same pair produces identical UUID", () => {
  const actorId = "actor-user-abc";
  const clientEventId = "12345678-1234-4234-8234-123456789abc";

  const uuid1 = generateDeterministicEventId(actorId, clientEventId);
  const uuid2 = generateDeterministicEventId(actorId, clientEventId);

  assert.equal(uuid1, uuid2);
});

test("deterministicEventId - domain separation: different actor or event produces different UUID", () => {
  const uuid1 = generateDeterministicEventId("actor-1", "event-1");
  const uuid2 = generateDeterministicEventId("actor-1", "event-2");
  const uuid3 = generateDeterministicEventId("actor-2", "event-1");

  assert.notEqual(uuid1, uuid2);
  assert.notEqual(uuid1, uuid3);
  assert.notEqual(uuid2, uuid3);
});

test("deterministicEventId - throws error on empty or non-string inputs", () => {
  assert.throws(() => generateDeterministicEventId("", "event-1"));
  assert.throws(() => generateDeterministicEventId("actor-1", ""));
});
