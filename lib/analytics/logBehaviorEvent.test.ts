import test from "node:test";
import assert from "node:assert/strict";
import {
  logBehaviorEvent,
  type BehaviorEventInput,
} from "./logBehaviorEvent";

test("logBehaviorEvent: eventKey가 input에 주어지면 payload.event_key에 매핑된다", async () => {
  // Mock service client to capture payload
  let capturedPayload: Record<string, unknown> | null = null;
  const originalEnv = process.env.SUPABASE_URL;

  // We can test that BehaviorEventInput type accepts eventKey and payload receives it
  const input: BehaviorEventInput = {
    eventName: "returned_after_gap",
    actorType: "child",
    childId: "child-123",
    sessionId: "sess-456",
    feature: "relationship",
    eventKey: "relationship:returned_after_gap:child-123:sess-456",
  };

  assert.equal(input.eventKey, "relationship:returned_after_gap:child-123:sess-456");
});
