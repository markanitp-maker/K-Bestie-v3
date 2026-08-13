import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideDailySingleOperation,
  evaluateMissionTimeGate,
  type MissionPolicySnapshot,
} from "./timePolicy.js";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql",
);

const kstDate = (hour: number, minute: number): Date =>
  new Date(Date.UTC(2026, 7, 10, hour - 9, minute));

const makeDb = (existing: Record<string, unknown> | null = null): SupabaseClient => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: existing, error: null }),
  };
  return { from: () => query } as unknown as SupabaseClient;
};

const activePolicy: MissionPolicySnapshot = {
  missionPolicyVersion: "v3_single_daily",
  effectiveAt: "2026-08-09T13:00:00+09:00",
};

test("Production 시간 게이트는 10:00 inclusive로 열린다", async () => {
  const db = makeDb();

  const beforeOpen = await evaluateMissionTimeGate({
    db,
    childId: "child-1",
    now: kstDate(9, 59),
    dependencies: { isMissionScheduleEnforced: () => true },
  });
  const open = await evaluateMissionTimeGate({
    db,
    childId: "child-1",
    now: kstDate(10, 0),
    dependencies: { isMissionScheduleEnforced: () => true },
  });

  assert.equal(beforeOpen.allowed, false);
  assert.equal(beforeOpen.reason, "before_open");
  assert.equal(beforeOpen.opensAtMinute, 600);
  assert.equal(beforeOpen.scheduleEnforced, true);
  assert.equal(open.allowed, true);
  assert.equal(open.businessDate, "2026-08-10");
});

test("Production 시간 게이트는 23:55 exclusive로 닫힌다", async () => {
  const allowed = await evaluateMissionTimeGate({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(23, 54),
    dependencies: { isMissionScheduleEnforced: () => true },
  });
  const closed = await evaluateMissionTimeGate({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(23, 55),
    dependencies: { isMissionScheduleEnforced: () => true },
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.closesAtMinute, 1435);
  assert.equal(closed.allowed, false);
  assert.equal(closed.reason, "closed");
});

test("Dev scheduleEnforced=false는 24시간 신규 시작을 허용한다", async () => {
  for (const [hour, minute] of [[0, 1], [8, 59], [23, 50], [23, 59]] as const) {
    const result = await evaluateMissionTimeGate({
      db: makeDb(),
      childId: "child-1",
      now: kstDate(hour, minute),
      dependencies: { isMissionScheduleEnforced: () => false },
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, null);
    assert.equal(result.scheduleEnforced, false);
  }
});

test("effective_at 이전에는 daily_single 신규 생성을 허용하지 않는다", async () => {
  const decision = await decideDailySingleOperation({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(13, 0),
    policy: {
      missionPolicyVersion: "v3_single_daily",
      effectiveAt: "2026-08-10T13:01:00+09:00",
    },
  });

  assert.deepEqual(decision, {
    action: "blocked",
    reason: "policy_not_effective",
    businessDate: "2026-08-10",
  });
});

test("당일 진행 중 daily_single은 시간 게이트 밖에서도 신규 생성 대신 resume한다", async () => {
  let scheduleLookupCount = 0;
  const decision = await decideDailySingleOperation({
    db: makeDb({
      session_id: "session-existing",
      status: "IN_PROGRESS",
      mission_policy_version: "v3_single_daily",
      effective_at: activePolicy.effectiveAt,
    }),
    childId: "child-1",
    now: kstDate(23, 30),
    policy: activePolicy,
    dependencies: {
      isMissionScheduleEnforced: () => {
        scheduleLookupCount += 1;
        return true;
      },
    },
  });

  assert.deepEqual(decision, {
    action: "resume",
    sessionId: "session-existing",
    businessDate: "2026-08-10",
  });
  assert.equal(scheduleLookupCount, 0);
});

test("당일 완료된 daily_single이 있으면 두 번째 신규 생성을 차단한다", async () => {
  const decision = await decideDailySingleOperation({
    db: makeDb({
      session_id: "session-completed",
      status: "COMPLETED",
      mission_policy_version: "v3_single_daily",
      effective_at: activePolicy.effectiveAt,
    }),
    childId: "child-1",
    now: kstDate(14, 0),
    policy: activePolicy,
  });

  assert.deepEqual(decision, {
    action: "blocked",
    reason: "daily_limit_reached",
    businessDate: "2026-08-10",
    existingSessionId: "session-completed",
  });
});

test("당일 FORCE_ENDED daily_single은 resume하지 않고 두 번째 신규 생성을 차단한다", async () => {
  const decision = await decideDailySingleOperation({
    db: makeDb({
      session_id: "session-force-ended",
      status: "FORCE_ENDED",
      mission_policy_version: "v3_single_daily",
      effective_at: activePolicy.effectiveAt,
    }),
    childId: "child-1",
    now: kstDate(14, 0),
    policy: activePolicy,
  });

  assert.deepEqual(decision, {
    action: "blocked",
    reason: "daily_limit_reached",
    businessDate: "2026-08-10",
    existingSessionId: "session-force-ended",
  });
});

test("활성 policy·운영 시간·당일 미생성 조건이면 daily_single 생성 메타데이터를 반환한다", async () => {
  const decision = await decideDailySingleOperation({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(13, 0),
    policy: activePolicy,
    dependencies: {
      isMissionScheduleEnforced: () => true,
    },
  });

  assert.equal(decision.action, "create");
  if (decision.action !== "create") return;
  assert.equal(decision.businessDate, "2026-08-10");
  assert.equal(decision.missionPolicyVersion, "v3_single_daily");
  assert.equal(decision.effectiveAt, activePolicy.effectiveAt);
});

test("Phase 3 migration은 additive·멱등이며 legacy round와 daily_single을 함께 보존한다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS mission_policy_version text NOT NULL DEFAULT 'v2_dual'/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS effective_at timestamptz/i);
  assert.match(sql, /'round1_day'[\s\S]*'round2_night'[\s\S]*'common'[\s\S]*'daily_single'/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS mission_progress_daily_single_child_date_key/i);
  assert.match(sql, /WHERE round_type = 'daily_single'/i);
  assert.match(sql, /IF NOT EXISTS[\s\S]*pg_constraint/i);
  assert.match(sql, /created_at >= effective_at/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN)\b/i);

  const withoutCommentsAndStrings = sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
  const openParentheses = [...withoutCommentsAndStrings].filter((character) => character === "(").length;
  const closeParentheses = [...withoutCommentsAndStrings].filter((character) => character === ")").length;
  assert.equal(openParentheses, closeParentheses);
  assert.ok(sql.trimEnd().endsWith(";"));
});
