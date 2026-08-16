import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { executeMemoryBatchForChildDate, type MemoryExecutionResult } from "./memoryV3";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("executeMemoryBatchForChildDate (Direct in-process execution without HTTP hop)", () => {
  const dummyDb = {} as SupabaseClient;
  const originalFetch = globalThis.fetch;
  const originalBatchSecret = process.env.BATCH_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    // fetch 호출 감시: 만약 fetch가 호출되면 즉시 실패
    globalThis.fetch = async () => {
      throw new Error("HTTP fetch called unexpectedly! Memory batch must run in-process without network hop.");
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalBatchSecret !== undefined) {
      process.env.BATCH_SECRET = originalBatchSecret;
    } else {
      delete process.env.BATCH_SECRET;
    }
    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  });

  it("1. fetch 가 한 번도 호출되지 않는다 (HTTP hop 제거 증명)", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch called");
    };

    const mockSummaries = async () => ({
      childrenProcessed: ["child-1"],
      longTermFactsCreated: 1,
      skipped: [],
      errors: [],
    });
    const mockFacts = async () => ({
      childrenProcessed: ["child-1"],
      factsCreated: 1,
      factsReinforced: 0,
      factsPromoted: 0,
      factsSkippedDuplicate: 0,
      skipped: [],
      errors: [],
      entityRelationWarnings: [],
    });

    const res = await executeMemoryBatchForChildDate("child-1", "2026-08-17", {
      db: dummyDb,
      generateSummaries: mockSummaries,
      generateFacts: mockFacts,
    });

    assert.equal(fetchCalled, false, "fetch must not be called");
    assert.equal(res.status, "completed");
  });

  it("2. BATCH_SECRET 과 CRON_SECRET 이 둘 다 없어도 정상 동작한다 (401 재발 방지 증명)", async () => {
    delete process.env.BATCH_SECRET;
    delete process.env.CRON_SECRET;

    const mockSummaries = async () => ({
      childrenProcessed: ["child-secret-test"],
      longTermFactsCreated: 1,
      skipped: [],
      errors: [],
    });
    const mockFacts = async () => ({
      childrenProcessed: ["child-secret-test"],
      factsCreated: 1,
      factsReinforced: 0,
      factsPromoted: 0,
      factsSkippedDuplicate: 0,
      skipped: [],
      errors: [],
      entityRelationWarnings: [],
    });

    const res = await executeMemoryBatchForChildDate("child-secret-test", "2026-08-17", {
      db: dummyDb,
      generateSummaries: mockSummaries,
      generateFacts: mockFacts,
    });

    assert.equal(res.status, "completed");
    assert.equal(res.childId, "child-secret-test");
    assert.equal(res.businessDate, "2026-08-17");
  });

  it("3. summary 는 성공하고 facts 가 해당 child 오류를 반환하면 → throw, 메시지 형식 유지", async () => {
    const mockSummaries = async () => ({
      childrenProcessed: ["child-err"],
      longTermFactsCreated: 1,
      skipped: [],
      errors: [],
    });
    const mockFacts = async () => ({
      childrenProcessed: [],
      factsCreated: 0,
      factsReinforced: 0,
      factsPromoted: 0,
      factsSkippedDuplicate: 0,
      skipped: [],
      errors: [{ childId: "child-err", error: "Fact extraction failed for LLM timeout" }],
      entityRelationWarnings: [],
    });

    await assert.rejects(
      async () => {
        await executeMemoryBatchForChildDate("child-err", "2026-08-17", {
          db: dummyDb,
          generateSummaries: mockSummaries,
          generateFacts: mockFacts,
        });
      },
      {
        name: "Error",
        message: "Memory facts failed for child: Fact extraction failed for LLM timeout",
      }
    );
  });

  it("4. generateMemoryFacts 가 통째로 throw 해도 summary 결과는 살아있고 오류로 처리된다", async () => {
    let summaryExecuted = false;
    const mockSummaries = async () => {
      summaryExecuted = true;
      return {
        childrenProcessed: ["child-throw"],
        longTermFactsCreated: 1,
        skipped: [],
        errors: [],
      };
    };
    const mockFacts = async () => {
      throw new Error("DB connection pool exhausted");
    };

    await assert.rejects(
      async () => {
        await executeMemoryBatchForChildDate("child-throw", "2026-08-17", {
          db: dummyDb,
          generateSummaries: mockSummaries,
          generateFacts: mockFacts,
        });
      },
      {
        name: "Error",
        message: "Memory facts failed for child: Error: DB connection pool exhausted",
      }
    );

    assert.equal(summaryExecuted, true, "Summary must have executed even if facts throws");
  });

  it("5. 정상 경로에서 MemoryExecutionResult 필드가 기존과 동일하다", async () => {
    const mockSummaries = async () => ({
      childrenProcessed: ["child-success"],
      longTermFactsCreated: 2,
      skipped: [],
      errors: [],
    });
    const mockFacts = async () => ({
      childrenProcessed: ["child-success"],
      factsCreated: 3,
      factsReinforced: 1,
      factsPromoted: 0,
      factsSkippedDuplicate: 0,
      skipped: [],
      errors: [],
      entityRelationWarnings: [],
    });

    const result: MemoryExecutionResult = await executeMemoryBatchForChildDate("child-success", "2026-08-17", {
      db: dummyDb,
      generateSummaries: mockSummaries,
      generateFacts: mockFacts,
    });

    assert.deepEqual(result, {
      status: "completed",
      childId: "child-success",
      businessDate: "2026-08-17",
    });

    // skipped 분기 검증
    const mockSummariesSkipped = async () => ({
      childrenProcessed: [],
      longTermFactsCreated: 0,
      skipped: ["child-skipped"],
      errors: [],
    });
    const mockFactsSkipped = async () => ({
      childrenProcessed: [],
      factsCreated: 0,
      factsReinforced: 0,
      factsPromoted: 0,
      factsSkippedDuplicate: 0,
      skipped: ["child-skipped"],
      errors: [],
      entityRelationWarnings: [],
    });

    const skippedResult = await executeMemoryBatchForChildDate("child-skipped", "2026-08-17", {
      db: dummyDb,
      generateSummaries: mockSummariesSkipped,
      generateFacts: mockFactsSkipped,
    });

    assert.deepEqual(skippedResult, {
      status: "skipped",
      childId: "child-skipped",
      businessDate: "2026-08-17",
    });
  });
});
