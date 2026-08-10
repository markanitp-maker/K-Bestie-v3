import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConversationGoal } from "./goalEngine.js";
import {
  awardMissionV3Reward,
  evaluateMissionV3RewardEligibility,
} from "./rewardPolicy.js";

const BUSINESS_DATE = "2026-08-10";
const CHILD_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql",
);

const makeGoals = (satisfiedGoalCount: number): ConversationGoal[] =>
  Array.from({ length: 4 }, (_, index) => ({
    goalId: `goal-${index + 1}`,
    missionSessionId: SESSION_ID,
    childId: CHILD_ID,
    goalOrder: index + 1,
    semanticGroup: `GROUP_${index + 1}`,
    priority: index === 0 ? "P1" : "P2",
    status: index < satisfiedGoalCount ? "SATISFIED" : "PENDING",
    evidenceSource: index < satisfiedGoalCount ? "child_utterance" : null,
    sourceTurnId: index < satisfiedGoalCount ? `turn-${index + 1}` : null,
    confidence: index < satisfiedGoalCount ? 0.9 : null,
    satisfiedAt: index < satisfiedGoalCount ? "2026-08-10T05:00:00.000Z" : null,
    parentQuestionId: null,
  }));

const createAtomicRewardMock = () => {
  const ledgerKeys = new Set<string>();
  let rpcCallCount = 0;

  const db = {
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      assert.equal(functionName, "award_mission_v3_reward");
      rpcCallCount += 1;
      await Promise.resolve();

      const rewardType = String(args.p_reward_type);
      const businessDate = String(args.p_business_date);
      const key = `${String(args.p_child_id)}:${businessDate}:${rewardType}`;
      const alreadyRewarded = ledgerKeys.has(key);
      if (!alreadyRewarded) ledgerKeys.add(key);

      return {
        data: [{
          rewarded: !alreadyRewarded,
          eligible: true,
          reason: alreadyRewarded ? "already_rewarded" : "rewarded",
          applied_reward_type: rewardType,
          applied_business_date: businessDate,
          satisfied_goal_count: 3,
        }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  return {
    db,
    ledgerKeys,
    getRpcCallCount: () => rpcCallCount,
  };
};

const award = (db: SupabaseClient, satisfiedGoalCount: number) => awardMissionV3Reward({
  db,
  childId: CHILD_ID,
  sourceSessionId: SESSION_ID,
  businessDate: BUSINESS_DATE,
  goals: makeGoals(satisfiedGoalCount),
});

test("같은 idempotency key를 두 번 연속 호출하면 두 번째 지급은 no-op이다", async () => {
  const mock = createAtomicRewardMock();

  const first = await award(mock.db, 3);
  const second = await award(mock.db, 3);

  assert.equal(first.rewarded, true);
  assert.equal(second.rewarded, false);
  assert.equal(second.reason, "already_rewarded");
  assert.equal(mock.ledgerKeys.size, 1);
});

test("동시 재시도는 child+business_date+reward_type당 원장 행을 하나만 만든다 (RPC 래퍼 레벨)", async () => {
  const mock = createAtomicRewardMock();
  const settled = await Promise.allSettled(
    Array.from({ length: 20 }, () => award(mock.db, 3)),
  );

  assert.ok(settled.every((result) => result.status === "fulfilled"));
  const results = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof award>>> =>
      result.status === "fulfilled")
    .map((result) => result.value);
  assert.equal(results.filter((result) => result.rewarded).length, 1);
  assert.equal(results.filter((result) => result.reason === "already_rewarded").length, 19);
  assert.equal(mock.ledgerKeys.size, 1);
});

test("reopen/재완료로 재호출해도 하루 보상은 한 행을 넘지 않는다", async () => {
  const mock = createAtomicRewardMock();

  await award(mock.db, 3);
  const reopened = await award(mock.db, 3);

  assert.equal(reopened.rewarded, false);
  assert.equal(mock.ledgerKeys.size, 1);
});

test("Boredom 조기종료로 Goal 2개 이하면 complete는 미지급이고 RPC를 호출하지 않는다", async () => {
  const mock = createAtomicRewardMock();
  const result = await award(mock.db, 2);

  assert.deepEqual(result, {
    rewarded: false,
    eligible: false,
    reason: "goal_threshold_not_met",
    satisfiedGoalCount: 2,
    rewardType: "mission_v3_complete",
    businessDate: BUSINESS_DATE,
  });
  assert.equal(mock.getRpcCallCount(), 0);
  assert.equal(mock.ledgerKeys.size, 0);
});

test("Goal 3개 이상이면 complete 지급 대상이다", () => {
  assert.deepEqual(evaluateMissionV3RewardEligibility({
    goals: makeGoals(3),
  }), {
    eligible: true,
    reason: "eligible",
    satisfiedGoalCount: 3,
  });
});

test("TS 사전판정과 RPC 반환 reason 문자열이 정확히 일치한다 (boredom 전용 문구 없음)", () => {
  const eligibility = evaluateMissionV3RewardEligibility({ goals: makeGoals(2) });
  assert.equal(eligibility.reason, "goal_threshold_not_met");

  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /'goal_threshold_not_met'/);
  assert.doesNotMatch(sql, /boredom_goal_threshold_not_met/);
});

test("Phase 4 migration은 기존 원장에 additive·멱등 제약과 원자 RPC만 추가한다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS gold_key_ledger_mission_v3_daily_reward_unique[\s\S]*child_id, business_date, reward_type/i,
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.award_mission_v3_reward/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(p_child_id::text\)\)/i);
  assert.match(sql, /count\(\*\) FILTER \(WHERE status = 'SATISFIED'\)/i);
  assert.match(sql, /v_satisfied_goal_count < 3/i);
  assert.match(
    sql,
    /ON CONFLICT \(child_id, business_date, reward_type\)[\s\S]*DO NOTHING/i,
  );
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/i);
  assert.doesNotMatch(sql, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?gold_key_ledger\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN)\b/i);

  const withoutCommentsAndStrings = sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
  const openParentheses = [...withoutCommentsAndStrings].filter((character) => character === "(").length;
  const closeParentheses = [...withoutCommentsAndStrings].filter((character) => character === ")").length;
  assert.equal(openParentheses, closeParentheses);
  assert.ok(sql.trimEnd().endsWith(";"));
});

test("R1: 마스터 지시서대로 시작 보상 reward_type이 코드에서 완전히 제거됐다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const codeOnly = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codeOnly, /mission_v3_start/);
});

test("R2: finalize_mission_turn_v1이 v3_single_daily 세션을 레거시 경로로 완료·보상하지 않는다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /v_completed := v_progress\.mission_policy_version IS DISTINCT FROM 'v3_single_daily'/,
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finalize_mission_turn_v1/i);
});

test("R3: 신규 CHECK가 source_session_id를 요구하지 않아 계정 삭제 FK 캐스케이드와 충돌하지 않는다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const checkBlock = sql.match(
    /ADD CONSTRAINT gold_key_ledger_mission_v3_source_check[\s\S]*?\) NOT VALID/,
  );
  assert.ok(checkBlock, "mission_v3_source_check constraint block not found");
  assert.doesNotMatch(checkBlock![0], /source_session_id IS NOT NULL/);
});

test("R4: ON CONFLICT DO NOTHING 판정이 RETURNING이 아닌 FOUND를 직접 확인한다", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const codeOnly = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codeOnly, /RETURNING true INTO v_inserted/);
  assert.doesNotMatch(codeOnly, /IF NOT v_inserted THEN/);
  assert.match(codeOnly, /IF NOT FOUND THEN/);
});
