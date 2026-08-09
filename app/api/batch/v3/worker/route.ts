import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { processCollectionJobsV3 } from "@/lib/batch/collection";
import { runContextCorrectionWorkerV3 } from "@/lib/batch/contextCorrectionV3";
import { processDailyReportJobsV3 } from "@/lib/batch/dailyReportV3";
import { runMemoryBatchWorkerV3 } from "@/lib/batch/memoryV3";
import { previousKstBusinessDate, reconcilePipelineV3 } from "@/lib/batch/reconcileV3";

export const runtime = "nodejs";

const WORKER_LIMIT = 10;
const MAX_ITERATIONS = 20;
// LLM 호출이 섞인 스테이지(correction/memory/daily_report)는 job당 비용이 훨씬 커서
// 같은 MAX_ITERATIONS를 그대로 쓰면 대량 백로그에서 뒤쪽 스테이지(memory/daily_report/
// final_reconcile)에 영영 못 도달할 수 있다(claude-review 지적, 2026-08-09).
const LLM_STAGE_MAX_ITERATIONS = 5;
// Vercel 기본 서버리스 타임아웃(300초)보다 여유를 두고 남은 예산이 없으면 이후 스테이지를
// 건너뛴다 — lease 타임아웃(5분) 덕에 다음 스케줄 폴에서 안전하게 이어지지만(§18 충족),
// 강제 타임아웃으로 죽는 대신 항상 정상 JSON 응답으로 "여기까지 하고 멈췄다"를 알린다.
const TIME_BUDGET_MS = 240_000;

type StageResult = {
  claimed: number;
  completed: number;
  failed: number;
  errors: unknown[];
  skipped?: number;
  details?: unknown;
  /** reconcile 스테이지 전용 — "완료된 job 수"가 아니라 self-healing으로 정규화/enqueue/재시도한
   *  액션 총합이다(claude-review 지적, completed와 의미가 달라 혼동 방지용으로 분리). */
  actions?: number;
  skippedStage?: true;
};

const SKIPPED_STAGE: StageResult = { claimed: 0, completed: 0, failed: 0, errors: [], skippedStage: true };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const countReconcileActions = (result: unknown): number => {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;

  return Object.values(result as Record<string, unknown>).reduce<number>(
    (total, value) => total + (typeof value === "number" ? value : 0),
    0
  );
};

const runStage = async (name: string, operation: () => Promise<StageResult>): Promise<StageResult> => {
  try {
    return await operation();
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[v3/worker] ${name} failed:`, message);
    return { claimed: 0, completed: 0, failed: 1, errors: [{ error: message }] };
  }
};

const runReconcileStage = async (businessDate: string): Promise<StageResult> => {
  const result = await reconcilePipelineV3(businessDate);
  return {
    claimed: 0,
    completed: 0,
    actions: countReconcileActions(result.result),
    failed: 0,
    errors: [],
    details: result,
  };
};

const runCollectionStage = async (phase: 1 | 2): Promise<StageResult> => {
  const workerId = `worker_col_${randomUUID()}`;
  const stage: StageResult = { claimed: 0, completed: 0, failed: 0, errors: [] };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await processCollectionJobsV3(phase, WORKER_LIMIT, workerId);
    stage.claimed += result.claimed;
    stage.completed += result.completed;
    stage.failed += result.claimed - result.completed;
    if (result.errors.length > 0) stage.errors.push(...result.errors);
    if (result.claimed === 0) break;
  }

  return stage;
};

// LLM 호출이 섞인 3개 스테이지(correction/memory/daily_report)는 job당 비용이 훨씬 커서
// collection과 같은 MAX_ITERATIONS(20)를 쓰면 대량 백로그에서 뒤쪽 스테이지에 영영 도달하지
// 못할 위험이 있다 — LLM_STAGE_MAX_ITERATIONS(5)로 낮춰 한 invocation의 시간 예산을 앞쪽
// 스테이지가 다 써버리지 않게 한다. 남은 backlog는 lease 타임아웃(5분) 뒤 다음 스케줄 폴에서
// claim RPC가 그대로 다시 집어간다(§18 lazy 복구, 물리적 job 유실 없음).
const runCorrectionStage = async (): Promise<StageResult> => {
  const workerId = `worker_corr_${randomUUID()}`;
  const stage: StageResult = { claimed: 0, completed: 0, failed: 0, errors: [], skipped: 0 };

  for (let iteration = 0; iteration < LLM_STAGE_MAX_ITERATIONS; iteration++) {
    const result = await runContextCorrectionWorkerV3(WORKER_LIMIT, workerId);
    stage.claimed += result.claimed;
    stage.completed += result.completed;
    stage.failed += result.failed;
    stage.skipped = (stage.skipped ?? 0) + result.skipped;
    if (result.errors.length > 0) stage.errors.push(...result.errors);
    if (result.claimed === 0) break;
  }

  return stage;
};

const runMemoryStage = async (): Promise<StageResult> => {
  const workerId = `worker_memory_${randomUUID()}`;
  const stage: StageResult = { claimed: 0, completed: 0, failed: 0, errors: [], skipped: 0 };

  for (let iteration = 0; iteration < LLM_STAGE_MAX_ITERATIONS; iteration++) {
    const result = await runMemoryBatchWorkerV3(WORKER_LIMIT, workerId);
    stage.claimed += result.claimed;
    stage.completed += result.success;
    stage.failed += result.failed;
    stage.skipped = (stage.skipped ?? 0) + result.skipped;
    if (result.errors.length > 0) stage.errors.push(...result.errors);
    if (result.claimed === 0) break;
  }

  return stage;
};

const runDailyReportStage = async (): Promise<StageResult> => {
  const workerId = `worker_daily_report_${randomUUID()}`;
  const stage: StageResult = { claimed: 0, completed: 0, failed: 0, errors: [], skipped: 0 };

  for (let iteration = 0; iteration < LLM_STAGE_MAX_ITERATIONS; iteration++) {
    const result = await processDailyReportJobsV3(WORKER_LIMIT, workerId, undefined, "scheduled");
    const claimed = result.completed + result.skipped + result.failed;
    stage.claimed += claimed;
    stage.completed += result.completed;
    stage.failed += result.failed;
    stage.skipped = (stage.skipped ?? 0) + result.skipped;
    if (result.errors.length > 0) stage.errors.push(...result.errors);
    if (claimed === 0) break;
  }

  return stage;
};

const handleWorker = async (req: Request) => {
  const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  const authHeader = req.headers.get("authorization") ?? "";

  if (
    configuredSecrets.length === 0 ||
    !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const businessDate = previousKstBusinessDate();
  const stages: Record<string, StageResult> = {};

  // 남은 시간 예산이 없으면 이후 스테이지를 실행하지 않고 SKIPPED_STAGE로 표시한다.
  // 이미 실행된 앞 스테이지의 claim은 그대로 유효(원자적 claim, §14)하고, 못 간 스테이지의
  // job은 lease 타임아웃 뒤 다음 스케줄 폴이 다시 집어간다 — 데이터 유실이나 이중 처리 없음.
  const runIfBudget = async (
    name: string,
    operation: () => Promise<StageResult>
  ): Promise<StageResult> => {
    if (Date.now() - startedAtMs >= TIME_BUDGET_MS) {
      console.warn(`[v3/worker] time budget exceeded, skipping stage: ${name}`);
      return SKIPPED_STAGE;
    }
    return runStage(name, operation);
  };

  stages.reconcile1 = await runIfBudget("reconcile1", () => runReconcileStage(businessDate));
  stages.collection_phase1 = await runIfBudget("collection_phase1", () => runCollectionStage(1));
  stages.collection_phase2 = await runIfBudget("collection_phase2", () => runCollectionStage(2));
  stages.reconcile2 = await runIfBudget("reconcile2", () => runReconcileStage(businessDate));
  stages.context_correction = await runIfBudget("context_correction", runCorrectionStage);
  stages.reconcile3 = await runIfBudget("reconcile3", () => runReconcileStage(businessDate));
  stages.memory = await runIfBudget("memory", runMemoryStage);
  stages.daily_report = await runIfBudget("daily_report", runDailyReportStage);
  stages.final_reconcile = await runIfBudget("final_reconcile", () => runReconcileStage(businessDate));

  // HTTP status만으로는 부분 실패를 알 수 없으므로(항상 200) 형제 라우트 관례에 맞춰
  // 최상위 success를 추가한다 — 모니터링/알림은 이 필드와 stages.*.errors를 봐야 한다.
  const success = Object.values(stages).every((stage) => stage.failed === 0);

  return NextResponse.json({
    success,
    businessDate,
    stages,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
};

export const GET = handleWorker;
export const POST = handleWorker;
