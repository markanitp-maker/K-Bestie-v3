import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideDailySingleOperation,
  evaluateMissionTimeGate,
  type MissionPolicySnapshot,
  type MissionTimeGateDisplayKey,
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

test("Production 시간 게이트는 09:00 inclusive로 열린다", async () => {
  const db = makeDb();

  const beforeOpen = await evaluateMissionTimeGate({
    db,
    childId: "child-1",
    now: kstDate(8, 59),
    dependencies: { isMissionScheduleEnforced: () => true },
  });
  const open = await evaluateMissionTimeGate({
    db,
    childId: "child-1",
    now: kstDate(9, 0),
    dependencies: { isMissionScheduleEnforced: () => true },
  });

  assert.equal(beforeOpen.allowed, false);
  assert.equal(beforeOpen.reason, "before_open");
  assert.equal(beforeOpen.opensAtMinute, 540);
  assert.equal(beforeOpen.scheduleEnforced, true);
  assert.equal(open.allowed, true);
  assert.equal(open.businessDate, "2026-08-10");
});

test("Production 시간 게이트는 23:50 exclusive로 닫힌다", async () => {
  const allowed = await evaluateMissionTimeGate({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(23, 49),
    dependencies: { isMissionScheduleEnforced: () => true },
  });
  const closed = await evaluateMissionTimeGate({
    db: makeDb(),
    childId: "child-1",
    now: kstDate(23, 50),
    dependencies: { isMissionScheduleEnforced: () => true },
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.closesAtMinute, 1430);
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

test("SCHEDULE_ENFORCED=true: 08:59 차단 / 09:00 허용 / 23:49 허용 / 23:50 차단", async () => {
  const db = makeDb();
  const deps = { isMissionScheduleEnforced: () => true };

  const p1 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(8, 59), dependencies: deps });
  assert.equal(p1.allowed, false);
  assert.equal(p1.reason, "before_open");
  assert.equal(p1.displayKey, "before_open");
  assert.equal(p1.opensAtMinute, 540);
  assert.equal(p1.closesAtMinute, 1430);
  assert.equal(p1.scheduleEnforced, true);

  const p2 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(9, 0), dependencies: deps });
  assert.equal(p2.allowed, true);
  assert.equal(p2.reason, null);
  assert.equal(p2.displayKey, null);
  assert.equal(p2.opensAtMinute, 540);
  assert.equal(p2.closesAtMinute, 1430);
  assert.equal(p2.scheduleEnforced, true);

  const p3 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(23, 49), dependencies: deps });
  assert.equal(p3.allowed, true);
  assert.equal(p3.reason, null);
  assert.equal(p3.displayKey, null);
  assert.equal(p3.opensAtMinute, 540);
  assert.equal(p3.closesAtMinute, 1430);
  assert.equal(p3.scheduleEnforced, true);

  const p4 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(23, 50), dependencies: deps });
  assert.equal(p4.allowed, false);
  assert.equal(p4.reason, "closed");
  assert.equal(p4.displayKey, "closed");
  assert.equal(p4.opensAtMinute, 540);
  assert.equal(p4.closesAtMinute, 1430);
  assert.equal(p4.scheduleEnforced, true);
});

test("SCHEDULE_ENFORCED=false + TIME_GATE_ENABLED=true: legacy 창 경계 4점 검증 (각 창의 시작 직전/시작/끝 직전/끝)", async () => {
  const db = makeDb();
  const deps = {
    isMissionScheduleEnforced: () => false,
    isMissionTimeGateEnabled: () => true,
  };

  // Window 1: 10:00 ~ 17:50 (exclusive)
  // 1. 시작 직전 (09:59): 차단 (before_open)
  const w1Before = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(9, 59), dependencies: deps });
  assert.equal(w1Before.allowed, false);
  assert.equal(w1Before.reason, "before_open");
  assert.equal(w1Before.displayKey, "before_open");
  assert.equal(w1Before.opensAtMinute, 600);
  assert.equal(w1Before.closesAtMinute, 1070);

  // 2. 시작 (10:00): 허용
  const w1Start = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(10, 0), dependencies: deps });
  assert.equal(w1Start.allowed, true);
  assert.equal(w1Start.reason, null);
  assert.equal(w1Start.displayKey, null);
  assert.equal(w1Start.opensAtMinute, 600);
  assert.equal(w1Start.closesAtMinute, 1070);

  // 3. 끝 직전 (17:49): 허용
  const w1EndBefore = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(17, 49), dependencies: deps });
  assert.equal(w1EndBefore.allowed, true);
  assert.equal(w1EndBefore.reason, null);
  assert.equal(w1EndBefore.displayKey, null);
  assert.equal(w1EndBefore.opensAtMinute, 600);
  assert.equal(w1EndBefore.closesAtMinute, 1070);

  // 4. 끝 (17:50): 차단 (between_rounds)
  const w1End = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(17, 50), dependencies: deps });
  assert.equal(w1End.allowed, false);
  assert.equal(w1End.reason, "before_open");
  assert.equal(w1End.displayKey, "between_rounds");
  assert.equal(w1End.opensAtMinute, 1080);
  assert.equal(w1End.closesAtMinute, 1440);

  // Window 2: 18:00 ~ 24:00 (exclusive)
  // 1. 시작 직전 (17:59): 차단 (between_rounds)
  const w2Before = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(17, 59), dependencies: deps });
  assert.equal(w2Before.allowed, false);
  assert.equal(w2Before.reason, "before_open");
  assert.equal(w2Before.displayKey, "between_rounds");
  assert.equal(w2Before.opensAtMinute, 1080);
  assert.equal(w2Before.closesAtMinute, 1440);

  // 2. 시작 (18:00): 허용
  const w2Start = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(18, 0), dependencies: deps });
  assert.equal(w2Start.allowed, true);
  assert.equal(w2Start.reason, null);
  assert.equal(w2Start.displayKey, null);
  assert.equal(w2Start.opensAtMinute, 1080);
  assert.equal(w2Start.closesAtMinute, 1440);

  // 3. 끝 직전 (23:59): 허용
  const w2EndBefore = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(23, 59), dependencies: deps });
  assert.equal(w2EndBefore.allowed, true);
  assert.equal(w2EndBefore.reason, null);
  assert.equal(w2EndBefore.displayKey, null);
  assert.equal(w2EndBefore.opensAtMinute, 1080);
  assert.equal(w2EndBefore.closesAtMinute, 1440);

  // 4. 끝 (다음날 00:00): 차단 (다음날 before_open)
  const w2End = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(24, 0), dependencies: deps });
  assert.equal(w2End.allowed, false);
  assert.equal(w2End.reason, "before_open");
  assert.equal(w2End.displayKey, "before_open");
  assert.equal(w2End.opensAtMinute, 600);
  assert.equal(w2End.closesAtMinute, 1070);
});

test("SCHEDULE_ENFORCED=false + TIME_GATE_ENABLED=true: 창 사이 구간(17:50~18:00)이 closed가 아닌 표시 키를 갖는지", async () => {
  const db = makeDb();
  const deps = {
    isMissionScheduleEnforced: () => false,
    isMissionTimeGateEnabled: () => true,
  };

  for (const minute of [50, 51, 55, 58, 59]) {
    const res = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(17, minute), dependencies: deps });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "before_open");
    assert.notEqual(res.displayKey, "closed");
    assert.equal(res.displayKey, "between_rounds");
  }
});

test("SCHEDULE_ENFORCED=false + TIME_GATE_ENABLED=false: 00:00, 12:00, 23:59 전부 허용", async () => {
  const db = makeDb();
  const deps = {
    isMissionScheduleEnforced: () => false,
    isMissionTimeGateEnabled: () => false,
  };

  for (const [hour, minute] of [[0, 0], [12, 0], [23, 59]]) {
    const res = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(hour, minute), dependencies: deps });
    assert.equal(res.allowed, true);
    assert.equal(res.reason, null);
    assert.equal(res.displayKey, null);
    assert.equal(res.scheduleEnforced, false);
    assert.equal(res.timeGateEnabled, false);
  }
});

test("두 플래그가 모두 true면 1번(SCHEDULE_ENFORCED) 규칙이 이긴다", async () => {
  const db = makeDb();
  const deps = {
    isMissionScheduleEnforced: () => true,
    isMissionTimeGateEnabled: () => true,
  };

  // 08:59 -> 차단 (before_open)
  const p1 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(8, 59), dependencies: deps });
  assert.equal(p1.allowed, false);
  assert.equal(p1.reason, "before_open");
  assert.equal(p1.displayKey, "before_open");

  // 09:00 -> 허용 (legacy 10:00 이전이어도 scheduleEnforced 우선)
  const p2 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(9, 0), dependencies: deps });
  assert.equal(p2.allowed, true);
  assert.equal(p2.reason, null);
  assert.equal(p2.opensAtMinute, 540);
  assert.equal(p2.closesAtMinute, 1430);

  // 17:50 -> 허용 (legacy 17:50 닫힘 구간이어도 scheduleEnforced 23:50까지 허용)
  const p3 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(17, 50), dependencies: deps });
  assert.equal(p3.allowed, true);
  assert.equal(p3.reason, null);

  // 23:49 -> 허용
  const p4 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(23, 49), dependencies: deps });
  assert.equal(p4.allowed, true);

  // 23:50 -> 차단 (legacy 24:00 이전이어도 scheduleEnforced 23:50 마감 우선)
  const p5 = await evaluateMissionTimeGate({ db, childId: "child-1", now: kstDate(23, 50), dependencies: deps });
  assert.equal(p5.allowed, false);
  assert.equal(p5.reason, "closed");
  assert.equal(p5.displayKey, "closed");
});

test("세 플래그 조합 각각에서 당일 IN_PROGRESS 세션이 있으면 시간창 밖이어도 resume 우선", async () => {
  const inProgressDb = makeDb({
    session_id: "session-in-progress-1",
    status: "IN_PROGRESS",
    mission_policy_version: "v3_single_daily",
    effective_at: activePolicy.effectiveAt,
  });

  // 조합 1: SCHEDULE_ENFORCED=true, 08:30 (시간 게이트 전)
  const d1 = await decideDailySingleOperation({
    db: inProgressDb,
    childId: "child-1",
    now: kstDate(8, 30),
    policy: activePolicy,
    dependencies: {
      isMissionScheduleEnforced: () => true,
      isMissionTimeGateEnabled: () => false,
    },
  });
  assert.deepEqual(d1, {
    action: "resume",
    sessionId: "session-in-progress-1",
    businessDate: "2026-08-10",
  });

  // 조합 2: SCHEDULE_ENFORCED=false + TIME_GATE_ENABLED=true, 17:55 (창 사이 구간)
  const d2 = await decideDailySingleOperation({
    db: inProgressDb,
    childId: "child-1",
    now: kstDate(17, 55),
    policy: activePolicy,
    dependencies: {
      isMissionScheduleEnforced: () => false,
      isMissionTimeGateEnabled: () => true,
    },
  });
  assert.deepEqual(d2, {
    action: "resume",
    sessionId: "session-in-progress-1",
    businessDate: "2026-08-10",
  });

  // 조합 3: SCHEDULE_ENFORCED=false + TIME_GATE_ENABLED=false, 03:00 (새벽)
  const d3 = await decideDailySingleOperation({
    db: inProgressDb,
    childId: "child-1",
    now: kstDate(3, 0),
    policy: activePolicy,
    dependencies: {
      isMissionScheduleEnforced: () => false,
      isMissionTimeGateEnabled: () => false,
    },
  });
  assert.deepEqual(d3, {
    action: "resume",
    sessionId: "session-in-progress-1",
    businessDate: "2026-08-10",
  });
});

