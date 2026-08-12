import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateMissionProgressRows, type MissionProgressMetricRow } from "./retentionChildMetrics";

describe("aggregateMissionProgressRows", () => {
  it("기존 시도 슬롯은 유지하고 COMPLETED 슬롯만 별도 집계한다", () => {
    const rows: MissionProgressMetricRow[] = [
      { child_id: "child-a", business_date: "2026-08-02", round_type: "round1_day", status: "FORCE_ENDED", updated_at: "2026-08-02T02:00:00Z" },
      { child_id: "child-a", business_date: "2026-08-03", round_type: "round1_day", status: "IN_PROGRESS", updated_at: "2026-08-03T01:00:00Z" },
      { child_id: "child-a", business_date: "2026-08-03", round_type: "round1_day", status: "COMPLETED", updated_at: "2026-08-03T02:00:00Z" },
      { child_id: "child-a", business_date: "2026-08-03", round_type: "round2_night", status: "COMPLETED", updated_at: "2026-08-03T12:00:00Z" },
      { child_id: "child-a", business_date: "2026-07-31", round_type: "round2_night", status: "COMPLETED", updated_at: "2026-07-31T12:00:00Z" },
      { child_id: "child-a", business_date: "2026-08-03", round_type: "common", status: "COMPLETED", updated_at: "2026-08-03T13:00:00Z" },
      { child_id: "child-a", business_date: "2026-08-04", round_type: "daily_single", status: "COMPLETED", updated_at: "2026-08-04T13:00:00Z" },
    ];

    const aggregate = aggregateMissionProgressRows(rows, { fromStr: "2026-08-01", toStr: "2026-08-07" }).get("child-a");
    assert.ok(aggregate);
    assert.equal(aggregate.missionCount, 4);
    assert.equal(aggregate.completedMissionCount, 3);
    assert.equal(aggregate.incompleteMissionCount, 1);
    assert.deepEqual(aggregate.activeDates, ["2026-08-02", "2026-08-03", "2026-08-04"]);
    assert.equal(aggregate.lastActivityAt, "2026-08-04T13:00:00Z");
    assert.deepEqual(aggregate.missionByDate["2026-08-03"], { mission1: true, mission2: true });
    assert.deepEqual(aggregate.missionByDate["2026-08-04"], { mission1: true, mission2: false });
  });
});
