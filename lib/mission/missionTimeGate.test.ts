import { describe, it } from "node:test";
import assert from "node:assert";
import { currentRound } from "./missionTimeGate";

describe("currentRound — Official KST Operating Hours", () => {
  it("Mission I: 10:00 to 17:50 (exclusive) is round1_day", () => {
    assert.strictEqual(currentRound(9, false, 59), null);
    assert.strictEqual(currentRound(10, false, 0), "round1_day");
    assert.strictEqual(currentRound(17, false, 49), "round1_day");
    assert.strictEqual(currentRound(17, false, 50), null);
  });

  it("Mission II: 18:00 to 24:00 (exclusive) is round2_night", () => {
    assert.strictEqual(currentRound(17, false, 55), null);
    assert.strictEqual(currentRound(18, false, 0), "round2_night");
    assert.strictEqual(currentRound(23, false, 59), "round2_night");
  });
});
