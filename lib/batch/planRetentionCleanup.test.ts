import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runPlanRetentionCleanup,
  type PlanRetentionCleanupDependencies,
} from "./planRetentionCleanup.ts";

const successPayloads: Record<string, { deleted_count: number; has_more: boolean }> = {
  purge_plan_retention_daily_reports_batch: { deleted_count: 2, has_more: true },
  purge_plan_retention_weekly_summaries_batch: { deleted_count: 3, has_more: false },
  purge_plan_retention_child_memory_batch: { deleted_count: 5, has_more: false },
};

const createDependencies = (failedRpc?: string): PlanRetentionCleanupDependencies => ({
  invokeRpc: async (rpcName) => {
    if (rpcName === failedRpc) {
      return { data: null, error: { message: "fixture failure" } };
    }
    return { data: successPayloads[rpcName], error: null };
  },
});

test("세 테이블 RPC 성공 결과의 삭제 건수와 hasMore를 집계", async () => {
  const result = await runPlanRetentionCleanup(
    { referenceDate: "2026-08-11", limit: 50 },
    createDependencies()
  );

  assert.equal(result.success, true);
  assert.equal(result.partialFailure, false);
  assert.equal(result.totalDeleted, 10);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.failedDatasets, []);
});

test("한 RPC 실패는 나머지 테이블 성공을 막지 않고 실패 dataset만 격리", async () => {
  const result = await runPlanRetentionCleanup(
    { referenceDate: "2026-08-11", limit: 50 },
    createDependencies("purge_plan_retention_weekly_summaries_batch")
  );

  assert.equal(result.success, false);
  assert.equal(result.partialFailure, true);
  assert.equal(result.totalDeleted, 7);
  assert.deepEqual(result.failedDatasets, ["weekly_summaries"]);
  assert.deepEqual(
    result.datasets.map((dataset) => dataset.dataset),
    ["daily_reports", "child_memory"]
  );
});

test("세 RPC가 모두 실패하면 fail-closed로 throw", async () => {
  const dependencies: PlanRetentionCleanupDependencies = {
    invokeRpc: async () => ({ data: null, error: { message: "fixture failure" } }),
  };

  await assert.rejects(
    runPlanRetentionCleanup({ referenceDate: "2026-08-11" }, dependencies),
    /All plan retention RPCs failed/
  );
});

test("batch limit 경계를 벗어나면 RPC를 호출하지 않고 거부", async () => {
  let invocationCount = 0;
  const dependencies: PlanRetentionCleanupDependencies = {
    invokeRpc: async () => {
      invocationCount += 1;
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    runPlanRetentionCleanup({ referenceDate: "2026-08-11", limit: 5001 }, dependencies),
    /Invalid limit/
  );
  assert.equal(invocationCount, 0);
});
