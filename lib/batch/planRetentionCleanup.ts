import { createServiceClient } from "@/lib/supabase/server";
import { getKstNow } from "./cleanupV3";

export const DEFAULT_PLAN_RETENTION_BATCH_LIMIT = 1000;
export const MAX_PLAN_RETENTION_BATCH_LIMIT = 5000;

export type PlanRetentionDataset = "daily_reports" | "weekly_summaries" | "child_memory";

interface RpcInvocationResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface PlanRetentionCleanupDependencies {
  invokeRpc: (rpcName: string, args: { p_reference_date: string; p_limit: number }) => Promise<RpcInvocationResult>;
}

export interface PlanRetentionCleanupOptions {
  referenceDate?: string;
  limit?: number;
}

export interface PlanRetentionDatasetResult {
  dataset: PlanRetentionDataset;
  deletedCount: number;
  hasMore: boolean;
}

export interface PlanRetentionCleanupResult {
  success: boolean;
  partialFailure: boolean;
  referenceDate: string;
  limit: number;
  totalDeleted: number;
  hasMore: boolean;
  datasets: PlanRetentionDatasetResult[];
  failedDatasets: PlanRetentionDataset[];
}

interface DatasetRpc {
  dataset: PlanRetentionDataset;
  rpcName: string;
}

const DATASET_RPCS: DatasetRpc[] = [
  { dataset: "daily_reports", rpcName: "purge_plan_retention_daily_reports_batch" },
  { dataset: "weekly_summaries", rpcName: "purge_plan_retention_weekly_summaries_batch" },
  { dataset: "child_memory", rpcName: "purge_plan_retention_child_memory_batch" },
];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

export const isValidPlanRetentionDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const parseDatasetResult = (
  dataset: PlanRetentionDataset,
  payload: unknown
): PlanRetentionDatasetResult => {
  if (!isRecord(payload)) {
    throw new Error(`Invalid ${dataset} retention RPC response`);
  }

  const deletedCount = payload.deleted_count;
  const hasMore = payload.has_more;
  if (
    typeof deletedCount !== "number"
    || !Number.isInteger(deletedCount)
    || deletedCount < 0
    || typeof hasMore !== "boolean"
  ) {
    throw new Error(`Invalid ${dataset} retention RPC response`);
  }

  return { dataset, deletedCount, hasMore };
};

const validateOptions = (options?: PlanRetentionCleanupOptions): { referenceDate: string; limit: number } => {
  const kstToday = getKstNow().dateStr;
  const referenceDate = options?.referenceDate ?? kstToday;
  const limit = options?.limit ?? DEFAULT_PLAN_RETENTION_BATCH_LIMIT;

  if (!isValidPlanRetentionDate(referenceDate)) {
    throw new Error("Invalid referenceDate: must be a valid YYYY-MM-DD date string");
  }
  if (referenceDate > kstToday) {
    throw new Error("Invalid referenceDate: cannot be in the future");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PLAN_RETENTION_BATCH_LIMIT) {
    throw new Error(`Invalid limit: must be an integer between 1 and ${MAX_PLAN_RETENTION_BATCH_LIMIT}`);
  }

  return { referenceDate, limit };
};

const createDefaultDependencies = (): PlanRetentionCleanupDependencies => {
  const db = createServiceClient();
  return {
    invokeRpc: async (rpcName, args) => {
      const { data, error } = await db.rpc(rpcName, args);
      return { data, error };
    },
  };
};

/**
 * Runs each table's bounded RPC independently. Individual RPC calls throw on
 * failure and Promise.allSettled isolates them, so one dataset cannot roll back
 * successful purges from another. Direct-table DELETE fallbacks are forbidden.
 */
export const runPlanRetentionCleanup = async (
  options?: PlanRetentionCleanupOptions,
  dependencies: PlanRetentionCleanupDependencies = createDefaultDependencies()
): Promise<PlanRetentionCleanupResult> => {
  const { referenceDate, limit } = validateOptions(options);

  const settled = await Promise.allSettled(
    DATASET_RPCS.map(async ({ dataset, rpcName }) => {
      const { data, error } = await dependencies.invokeRpc(rpcName, {
        p_reference_date: referenceDate,
        p_limit: limit,
      });

      if (error) {
        throw new Error(`${dataset} retention RPC failed`);
      }

      return parseDatasetResult(dataset, data);
    })
  );

  const datasets: PlanRetentionDatasetResult[] = [];
  const failedDatasets: PlanRetentionDataset[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      datasets.push(result.value);
    } else {
      failedDatasets.push(DATASET_RPCS[index].dataset);
    }
  });

  if (failedDatasets.length === DATASET_RPCS.length) {
    throw new Error("All plan retention RPCs failed");
  }

  return {
    success: failedDatasets.length === 0,
    partialFailure: failedDatasets.length > 0,
    referenceDate,
    limit,
    totalDeleted: datasets.reduce((sum, result) => sum + result.deletedCount, 0),
    hasMore: datasets.some((result) => result.hasMore),
    datasets,
    failedDatasets,
  };
};
