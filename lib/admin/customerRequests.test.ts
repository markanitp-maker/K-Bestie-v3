import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTransitionStatus, isCustomerRequestCategory, kstDateRange } from "./customerRequests";

describe("customer request policy", () => {
  it("accepts the three new categories and preserved legacy voc", () => {
    for (const value of ["inquiry", "suggestion", "bug", "voc"]) assert.equal(isCustomerRequestCategory(value), true);
    assert.equal(isCustomerRequestCategory("feature"), false);
  });

  it("only moves status one step forward", () => {
    assert.equal(canTransitionStatus("open", "in_progress"), true);
    assert.equal(canTransitionStatus("in_progress", "resolved"), true);
    assert.equal(canTransitionStatus("resolved", "closed"), true);
    assert.equal(canTransitionStatus("open", "resolved"), false);
    assert.equal(canTransitionStatus("resolved", "open"), false);
  });

  it("uses KST day boundaries", () => {
    assert.deepEqual(kstDateRange("2026-08-08", "2026-08-08"), {
      from: "2026-08-08T00:00:00+09:00",
      toExclusive: "2026-08-08T15:00:00.000Z",
    });
  });
});
