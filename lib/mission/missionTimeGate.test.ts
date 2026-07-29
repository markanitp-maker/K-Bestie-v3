import { describe, it } from "node:test";
import assert from "node:assert";
import { currentRound } from "./missionTimeGate";

describe("currentRound — 기존 Dev 경계(scheduleEnforced=false, 기본값)", () => {
  it("13~17시(미만)는 round1_day", () => {
    assert.strictEqual(currentRound(12), null);
    assert.strictEqual(currentRound(13), "round1_day");
    assert.strictEqual(currentRound(16), "round1_day");
    assert.strictEqual(currentRound(17), null);
  });

  it("19~23시(포함)는 round2_night", () => {
    assert.strictEqual(currentRound(18), null);
    assert.strictEqual(currentRound(19), "round2_night");
    assert.strictEqual(currentRound(23), "round2_night");
    assert.strictEqual(currentRound(0), null);
  });

  it("scheduleEnforced를 넘기지 않아도(기본값 false) 기존 경계와 동일하다", () => {
    for (let h = 0; h < 24; h++) {
      assert.strictEqual(currentRound(h), currentRound(h, false));
    }
  });
});

describe("currentRound — 031 Production 전용 경계(scheduleEnforced=true)", () => {
  it("미션-I: 12:00부터 가능, 17:00부터 불가", () => {
    assert.strictEqual(currentRound(11, true), null);
    assert.strictEqual(currentRound(12, true), "round1_day");
    assert.strictEqual(currentRound(16, true), "round1_day");
    assert.strictEqual(currentRound(17, true), null);
  });

  it("미션-II: 19:00부터 가능, 23:00부터 불가", () => {
    assert.strictEqual(currentRound(18, true), null);
    assert.strictEqual(currentRound(19, true), "round2_night");
    assert.strictEqual(currentRound(22, true), "round2_night");
    assert.strictEqual(currentRound(23, true), null);
  });

  it("00~11, 17~18, 23시는 미션 이용 불가", () => {
    for (const h of [0, 6, 11, 17, 18, 23]) {
      assert.strictEqual(currentRound(h, true), null);
    }
  });
});
