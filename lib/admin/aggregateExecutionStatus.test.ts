import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClient } from "@supabase/supabase-js";
import { aggregateExecutionStatus } from "./aggregateExecutionStatus";

function createMockDb(tables: {
  pipeline_execution_items?: any[];
  daily_reports?: any[];
  child_profiles?: any[];
  family_members?: any[];
  member_accounts?: any[];
}) {
  return {
    from: (tableName: string) => {
      const rows = tables[tableName as keyof typeof tables] || [];
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        then: (resolve: (val: any) => any, reject?: (err: any) => any) => {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

test("1. 리포트 행이 있고 execution item이 pending이면 표시를 '완료'로 보정한다 (2026-08-16 사고 재현)", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "memory_batch",
        status: "completed",
        business_date: "2026-08-16",
      },
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "pending",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [
      {
        child_id: "child-1",
        created_at: "2026-08-16T12:00:00Z",
        updated_at: "2026-08-16T12:05:00Z",
        generation_source: "manual",
        generation_version: 1,
      },
    ],
    child_profiles: [{ id: "child-1", name: "서아" }],
  });

  const result = await aggregateExecutionStatus(db, "exec-1", "generate");

  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].report, "완료");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, true);
  assert.equal(result.statuses[0].lastReportGeneratedAt, "2026-08-16T12:05:00Z");
  assert.equal(result.summary.report.created, 1);
  assert.equal(result.summary.report.failed, 0);
  assert.equal(result.summary.report.skipped, 0);
  assert.equal(result.isComplete, true);
});

test("2. 리포트 행이 없고 execution item이 pending이면 표시를 '대기'로 유지한다", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "pending",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [],
    child_profiles: [{ id: "child-1", name: "서아" }],
  });

  const result = await aggregateExecutionStatus(db, "exec-2", "generate");

  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].report, "대기");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, undefined);
  assert.equal(result.summary.report.created, 0);
  assert.equal(result.isComplete, false);
});

test("3. 리포트 행이 있어도 item이 failed면 '실패'를 덮어쓰지 않고 유지한다", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "failed",
        error_code: "REPORT_GEN_FAIL",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [
      {
        child_id: "child-1",
        created_at: "2026-08-16T12:00:00Z",
        updated_at: "2026-08-16T12:00:00Z",
      },
    ],
    child_profiles: [{ id: "child-1", name: "서아" }],
  });

  const result = await aggregateExecutionStatus(db, "exec-3", "generate");

  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].report, "실패");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, undefined);
  assert.equal(result.summary.report.failed, 1);
  assert.equal(result.summary.report.created, 0);
  assert.equal(result.partialFailure, true);
});

test("4. 리포트 행이 있어도 item이 completed + NO_CONVERSATION이면 '건너뜀(대화 없음)'을 유지한다", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "completed",
        outcome: "NO_CONVERSATION",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [
      {
        child_id: "child-1",
        created_at: "2026-08-16T12:00:00Z",
        updated_at: "2026-08-16T12:00:00Z",
      },
    ],
    child_profiles: [{ id: "child-1", name: "서아" }],
  });

  const result = await aggregateExecutionStatus(db, "exec-4", "generate");

  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].report, "건너뜀(대화 없음)");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, undefined);
  assert.equal(result.summary.report.skipped, 1);
  assert.equal(result.summary.report.created, 0);
});

test("5. 메모리 단계 상태가 리포트 보정 때문에 바뀌지 않는다 (독립성 보장)", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "memory_batch",
        status: "processing",
        business_date: "2026-08-16",
      },
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "pending",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [
      {
        child_id: "child-1",
        created_at: "2026-08-16T12:00:00Z",
        updated_at: "2026-08-16T12:00:00Z",
      },
    ],
    child_profiles: [{ id: "child-1", name: "서아" }],
  });

  const result = await aggregateExecutionStatus(db, "exec-5", "generate");

  assert.equal(result.statuses.length, 1);
  // 리포트는 완료로 보정됨
  assert.equal(result.statuses[0].report, "완료");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, true);
  // 메모리는 원래 처리 중 상태 유지
  assert.equal(result.statuses[0].memory, "처리 중");
  assert.equal(result.statuses[0].memoryRawStatus, "processing");
  assert.equal(result.summary.memory.success, 0);
  assert.equal(result.summary.memory.failed, 0);
  // 메모리가 processing이므로 isComplete는 false여야 함
  assert.equal(result.isComplete, false);
});

test("6. [추가검증] processing 또는 retry_wait 상태여도 실제 행이 존재하면 '완료'로 보정된다", async () => {
  const db = createMockDb({
    pipeline_execution_items: [
      {
        child_id: "child-1",
        job_type: "daily_report",
        status: "processing",
        business_date: "2026-08-16",
      },
      {
        child_id: "child-2",
        job_type: "daily_report",
        status: "retry_wait",
        business_date: "2026-08-16",
      },
    ],
    daily_reports: [
      {
        child_id: "child-1",
        created_at: "2026-08-16T12:00:00Z",
      },
      {
        child_id: "child-2",
        created_at: "2026-08-16T12:00:00Z",
      },
    ],
    child_profiles: [
      { id: "child-1", name: "서아" },
      { id: "child-2", name: "서현" },
    ],
  });

  const result = await aggregateExecutionStatus(db, "exec-6");

  assert.equal(result.statuses[0].report, "완료");
  assert.equal(result.statuses[0].reportStatusDerivedFromRow, true);
  assert.equal(result.statuses[1].report, "완료");
  assert.equal(result.statuses[1].reportStatusDerivedFromRow, true);
  assert.equal(result.summary.report.created, 2);
  assert.equal(result.isComplete, true);
});
