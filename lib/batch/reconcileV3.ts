import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { getOffsetDateStr, toKSTDateStr } from "@/lib/analytics/kstDate";
import { isValidDateString } from "@/lib/batch/collection";

export function previousKstBusinessDate(now: Date = new Date()): string {
  return getOffsetDateStr(toKSTDateStr(now.toISOString()), -1);
}

export async function reconcilePipelineV3(targetDate: string, executionId = randomUUID()) {
  if (!isValidDateString(targetDate)) throw new Error("Invalid targetDate");
  const db = createServiceClient();
  const { data, error } = await db.rpc("reconcile_pipeline_v3", {
    p_business_date: targetDate,
    p_execution_id: executionId,
  });
  if (error) throw new Error(`Reconciliation failed: ${error.message}`);
  return { executionId, targetDate, result: data?.[0] ?? {} };
}
