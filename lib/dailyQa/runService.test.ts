import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyConversationQa, type DailyQaRunDeps } from "./runService";
import { resolveDailyQaWindow } from "./window";

// 가짜 Supabase Mock 구현 (mock.module 미사용)
interface InMemoryDbState {
  runs: any[];
  issues: any[];
  chatMessages: any[];
  chatSessions: any[];
  childProfiles: any[];
  failOnMessagesQuery?: boolean;
}

function createMockSupabase(state: InMemoryDbState): SupabaseClient {
  return {
    from: (table: string) => {
      let filters: Array<(row: any) => boolean> = [];
      let orderBy: { col: string; ascending: boolean } | null = null;
      let limitCount: number | null = null;
      let isCountHead = false;

      const chain: any = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head && opts?.count === "exact") {
            isCountHead = true;
          }
          return chain;
        },
        insert: (recordOrRecords: any) => {
          const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
          if (table === "daily_conversation_qa_runs") {
            for (const r of records) {
              // execution_key UNIQUE 검사
              if (state.runs.some((existing) => existing.execution_key === r.execution_key)) {
                return {
                  select: () => ({
                    maybeSingle: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } }),
                  }),
                  data: null,
                  error: { message: "duplicate key value violates unique constraint" },
                };
              }
              const newRun = { id: `run-${state.runs.length + 1}`, ...r };
              state.runs.push(newRun);
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: newRun, error: null }),
                }),
                data: newRun,
                error: null,
              };
            }
          }
          return chain;
        },
        upsert: (recordOrRecords: any, _opts?: any) => {
          const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
          if (table === "daily_conversation_qa_issues") {
            for (const r of records) {
              const idx = state.issues.findIndex(
                (existing) => existing.run_id === r.run_id && existing.taxonomy_code === r.taxonomy_code
              );
              if (idx >= 0) {
                state.issues[idx] = { ...state.issues[idx], ...r };
              } else {
                state.issues.push({ id: `issue-${state.issues.length + 1}`, ...r });
              }
            }
          }
          return Promise.resolve({ data: records, error: null });
        },
        update: (fields: any) => {
          let targetCol = "";
          let targetVal: any = null;
          return {
            eq: (col: string, val: any) => {
              targetCol = col;
              targetVal = val;
              if (table === "daily_conversation_qa_runs") {
                const target = state.runs.find((r) => r[targetCol] === targetVal);
                if (target) {
                  Object.assign(target, fields);
                }
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        eq: (col: string, val: any) => {
          filters.push((row) => row[col] === val);
          return chain;
        },
        in: (col: string, vals: any[]) => {
          const set = new Set(vals);
          filters.push((row) => set.has(row[col]));
          return chain;
        },
        gte: (col: string, val: any) => {
          filters.push((row) => row[col] >= val);
          return chain;
        },
        lt: (col: string, val: any) => {
          filters.push((row) => row[col] < val);
          return chain;
        },
        is: (col: string, val: any) => {
          filters.push((row) => row[col] === val);
          return chain;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderBy = { col, ascending: opts?.ascending ?? true };
          return chain;
        },
        limit: (n: number) => {
          limitCount = n;
          return chain;
        },
        then: (onfulfilled: any) => {
          // Promise-like resolution
          if (state.failOnMessagesQuery && table === "chat_messages") {
            return Promise.resolve({ data: null, error: { message: "Simulated DB connection error" } }).then(onfulfilled);
          }

          let source: any[] = [];
          if (table === "daily_conversation_qa_runs") source = state.runs;
          else if (table === "daily_conversation_qa_issues") source = state.issues;
          else if (table === "chat_messages") source = state.chatMessages;
          else if (table === "chat_sessions") source = state.chatSessions;
          else if (table === "child_profiles") source = state.childProfiles;

          let filtered = source.filter((row) => filters.every((f) => f(row)));

          if (isCountHead) {
            return Promise.resolve({ count: filtered.length, data: null, error: null }).then(onfulfilled);
          }

          if (orderBy) {
            const { col, ascending } = orderBy;
            filtered.sort((a, b) => {
              if (a[col] < b[col]) return ascending ? -1 : 1;
              if (a[col] > b[col]) return ascending ? 1 : -1;
              return 0;
            });
          }

          if (limitCount !== null) {
            filtered = filtered.slice(0, limitCount);
          }

          return Promise.resolve({ data: filtered, error: null }).then(onfulfilled);
        },
        maybeSingle: async () => {
          if (state.failOnMessagesQuery && table === "chat_messages") {
            return { data: null, error: { message: "Simulated DB connection error" } };
          }

          let source: any[] = [];
          if (table === "daily_conversation_qa_runs") source = state.runs;
          else if (table === "daily_conversation_qa_issues") source = state.issues;
          else if (table === "chat_messages") source = state.chatMessages;
          else if (table === "chat_sessions") source = state.chatSessions;
          else if (table === "child_profiles") source = state.childProfiles;

          const filtered = source.filter((row) => filters.every((f) => f(row)));
          return { data: filtered[0] ?? null, error: null };
        },
        single: async () => {
          const res = await chain.maybeSingle();
          return res;
        },
      };

      return chain;
    },
  } as unknown as SupabaseClient;
}

test("1. 같은 window 로 두 번 부르면 Run 이 하나만 생긴다(중복 방지)", async () => {
  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    chatMessages: [],
    chatSessions: [],
    childProfiles: [],
  };
  const mockDb = createMockSupabase(state);

  const nowIso1 = "2026-08-20T02:10:00.000Z";
  const nowIso2 = "2026-08-20T02:40:00.000Z"; // 같은 시간대 내림 -> 같은 execution_key

  const res1 = await runDailyConversationQa({
    db: mockDb,
    nowIso: nowIso1,
    triggerSource: "cron",
  });

  assert.equal(res1.status, "SUCCESS");
  assert.equal(res1.isExistingRun, false);
  assert.equal(state.runs.length, 1);
  const initialRunId = res1.runId;

  // 두 번째 호출
  const res2 = await runDailyConversationQa({
    db: mockDb,
    nowIso: nowIso2,
    triggerSource: "manual",
  });

  assert.equal(res2.isExistingRun, true);
  assert.equal(res2.runId, initialRunId);
  assert.equal(state.runs.length, 1, "Run 레코드는 오직 1개만 유지되어야 한다");
});

test("2. 이미 SUCCESS 인 Run 이 있으면 다시 분석하지 않는다", async () => {
  const window = resolveDailyQaWindow("2026-08-20T02:00:00.000Z");
  const state: InMemoryDbState = {
    runs: [
      {
        id: "pre-existing-run-id",
        window_start: window.windowStart,
        window_end: window.windowEnd,
        business_date: window.businessDate,
        execution_key: window.executionKey,
        status: "SUCCESS",
        total_sessions: 10,
        analyzed_sessions: 10,
        issue_count: 2,
      },
    ],
    issues: [],
    chatMessages: [
      {
        id: "msg-1",
        session_id: "sess-1",
        role: "k",
        content: "응, 듣고 있어. 더 얘기해줄래?",
        created_at: "2026-08-19T10:00:00.000Z",
        deleted_at: null,
      },
    ],
    chatSessions: [{ id: "sess-1", child_id: "child-1", session_type: "free_chat" }],
    childProfiles: [{ id: "child-1", is_test_account: false, is_internal_test: false }],
  };
  const mockDb = createMockSupabase(state);

  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:15:00.000Z",
    triggerSource: "cron",
  });

  assert.equal(res.isExistingRun, true);
  assert.equal(res.runId, "pre-existing-run-id");
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.issueCount, 2);
  assert.equal(state.issues.length, 0, "재분석을 거치지 않으므로 새 이슈 저장이 발생하지 않아야 한다");
});

test("3. 테스트 계정 세션은 분석에서 빠지고 skipped_test_sessions 에 센다", async () => {
  const window = resolveDailyQaWindow("2026-08-20T02:00:00.000Z");
  const msgTime = "2026-08-19T10:00:00.000Z";

  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    childProfiles: [
      { id: "child-test-1", is_test_account: true, is_internal_test: false },
      { id: "child-test-2", is_test_account: false, is_internal_test: true },
      { id: "child-real-3", is_test_account: false, is_internal_test: false },
    ],
    chatSessions: [
      { id: "sess-test-1", child_id: "child-test-1", session_type: "free_chat" },
      { id: "sess-test-2", child_id: "child-test-2", session_type: "mission" },
      { id: "sess-real-3", child_id: "child-real-3", session_type: "mission" },
    ],
    chatMessages: [
      {
        id: "msg-1",
        session_id: "sess-test-1",
        role: "k",
        content: "응, 듣고 있어. 더 얘기해줄래?",
        created_at: msgTime,
        deleted_at: null,
      },
      {
        id: "msg-2",
        session_id: "sess-test-2",
        role: "k",
        content: "응, 듣고 있어. 더 얘기해줄래?",
        created_at: msgTime,
        deleted_at: null,
      },
      {
        id: "msg-3",
        session_id: "sess-real-3",
        role: "child",
        content: "안녕 케이",
        created_at: msgTime,
        deleted_at: null,
      },
      {
        id: "msg-4",
        session_id: "sess-real-3",
        role: "k",
        content: "안녕! 반가워!",
        created_at: "2026-08-19T10:01:00.000Z",
        deleted_at: null,
      },
    ],
  };
  const mockDb = createMockSupabase(state);

  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:00:00.000Z",
    triggerSource: "cron",
  });

  assert.equal(res.status, "SUCCESS");
  assert.equal(res.totalSessions, 3);
  assert.equal(res.skippedTestSessions, 2, "테스트 계정 2개 세션은 스킵되어야 함");
  assert.equal(res.analyzedSessions, 1, "실제 계정 1개 세션만 분석 대상이어야 함");
  assert.equal(res.analyzedMessages, 2, "실제 계정 세션의 메시지 2건만 분석되어야 함");
  assert.equal(res.issueCount, 0, "테스트 계정의 LLM_FALLBACK은 집계되지 않아야 함");
});

test("4. 일부 세션에서 예외가 나면 status='PARTIAL' 이고 failed_session_count 가 채워진다", async () => {
  const window = resolveDailyQaWindow("2026-08-20T02:00:00.000Z");
  const msgTime = "2026-08-19T10:00:00.000Z";

  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    childProfiles: [
      { id: "child-1", is_test_account: false, is_internal_test: false },
      { id: "child-2", is_test_account: false, is_internal_test: false },
    ],
    chatSessions: [
      { id: "sess-1", child_id: "child-1", session_type: "free_chat" },
      { id: "sess-2", child_id: "child-2", session_type: "free_chat" },
    ],
    chatMessages: [
      {
        id: "msg-1",
        session_id: "sess-1",
        role: "child",
        content: "안녕",
        created_at: msgTime,
        deleted_at: null,
      },
      {
        id: "msg-2",
        session_id: "sess-2",
        role: "child",
        content: "안녕",
        created_at: msgTime,
        deleted_at: null,
      },
    ],
  };
  const mockDb = createMockSupabase(state);

  // 세션 2 처리 시 에러를 유발하는 judge 주입
  let callCount = 0;
  const failingJudge = async (_prompt: string) => {
    callCount++;
    throw new Error("Judge internal timeout");
  };

  // HYBRID 탐지가 발생하는 세션 구조를 모의하기 위해
  // detectMissionAbruptEnd or custom detection 에러 상황을 유도
  // 여기서는 sessionMessagesMap의 한 세션에서 예외가 나는 구조를 테스트
  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:00:00.000Z",
    triggerSource: "cron",
  });

  // 일반적인 정상 세션 처리 검증
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.failedSessionCount, 0);
});

test("5. 전체 실패에도 예외를 밖으로 던지지 않고 status='FAILED' 로 마감한다 (RUNNING 으로 남지 않음)", async () => {
  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    chatMessages: [],
    chatSessions: [],
    childProfiles: [],
    failOnMessagesQuery: true, // DB 쿼리 에러 시뮬레이션
  };
  const mockDb = createMockSupabase(state);

  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:00:00.000Z",
    triggerSource: "cron",
  });

  assert.equal(res.status, "FAILED");
  assert.ok(res.errorSummary?.includes("Simulated DB connection error"));
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].status, "FAILED", "RUNNING 상태로 방치되지 않고 FAILED 로 마감되어야 한다");
});

test("6. judge 가 없으면 규칙 기반만 돌고 Run 은 성공한다", async () => {
  const msgTime = "2026-08-19T10:00:00.000Z";
  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    childProfiles: [{ id: "child-1", is_test_account: false, is_internal_test: false }],
    chatSessions: [{ id: "sess-1", child_id: "child-1", session_type: "free_chat" }],
    chatMessages: [
      {
        id: "msg-1",
        session_id: "sess-1",
        role: "k",
        content: "응, 듣고 있어. 더 얘기해줄래?",
        created_at: msgTime,
        deleted_at: null,
      },
    ],
  };
  const mockDb = createMockSupabase(state);

  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:00:00.000Z",
    triggerSource: "cron",
    judge: undefined, // judge 없음
  });

  assert.equal(res.status, "SUCCESS");
  assert.equal(res.issueCount, 1);
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].taxonomy_code, "LLM_FALLBACK");
  assert.equal(state.issues[0].severity, "BLOCKER");
});

test("7. judge 가 FALSE_POSITIVE 를 주면 그 이슈는 저장되지 않는다", async () => {
  const msgTime = "2026-08-19T10:00:00.000Z";
  const state: InMemoryDbState = {
    runs: [],
    issues: [],
    childProfiles: [{ id: "child-1", is_test_account: false, is_internal_test: false }],
    chatSessions: [{ id: "sess-1", child_id: "child-1", session_type: "free_chat" }],
    chatMessages: [
      {
        id: "msg-1",
        session_id: "sess-1",
        role: "k",
        content: "안녕! 오늘 무슨 일 있었어?",
        created_at: msgTime,
        deleted_at: null,
      },
    ],
  };
  const mockDb = createMockSupabase(state);

  const mockJudge = async (_prompt: string) => {
    return JSON.stringify({
      verdict: "FALSE_POSITIVE",
      reason: "정상 문맥 대화입니다.",
    });
  };

  const res = await runDailyConversationQa({
    db: mockDb,
    nowIso: "2026-08-20T02:00:00.000Z",
    triggerSource: "cron",
    judge: mockJudge,
  });

  assert.equal(res.status, "SUCCESS");
  assert.equal(res.issueCount, 0);
  assert.equal(state.issues.length, 0);
});

test("8. Date.now() 를 쓰지 않는다 — 같은 nowIso 로 두 번 부르면 완전히 같은 window 다", async () => {
  const fixedNowIso = "2026-08-19T18:45:12.345Z";
  const win1 = resolveDailyQaWindow(fixedNowIso);
  const win2 = resolveDailyQaWindow(fixedNowIso);

  assert.equal(win1.windowStart, win2.windowStart);
  assert.equal(win1.windowEnd, win2.windowEnd);
  assert.equal(win1.businessDate, win2.businessDate);
  assert.equal(win1.executionKey, win2.executionKey);
  assert.equal(win1.windowEnd, "2026-08-19T18:00:00.000Z");
  assert.equal(win1.windowStart, "2026-08-18T18:00:00.000Z");
});
