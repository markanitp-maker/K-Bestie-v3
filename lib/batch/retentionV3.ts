import { createServiceClient } from "@/lib/supabase/server";
import { getKstNow } from "./cleanupV3";

export interface V3RetentionPurgeOptions {
  referenceDate?: string;
  cutoffDate?: string;
  limit?: number;
}

export interface V3RetentionPurgeResult {
  success: boolean;
  referenceDate: string;
  cutoffDate: string;
  correctedDeleted: number;
  rawDeleted: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Helper to validate a YYYY-MM-DD date string.
 */
export function isValidDateString(dateStr: string): boolean {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/**
 * Helper to subtract N days from a "YYYY-MM-DD" date string in UTC.
 */
export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Executes bounded 7-day retention purge for raw and corrected V3 datasets.
 * Rules:
 * 1. Retention is exactly seven days by business_date.
 * 2. Raw and corrected V3 datasets use the exact same cutoff policy (business_date <= cutoffDate).
 * 3. Deletes parent child/date units via atomic RPC purge_v3_retention_batch, relying on FK CASCADE safety for child message tables.
 * 4. Fails closed: direct-table DELETE fallbacks are prohibited.
 * 5. Memory and daily_reports are NOT purged.
 */
export async function runV3RetentionPurge(
  options?: V3RetentionPurgeOptions
): Promise<V3RetentionPurgeResult> {
  const kst = getKstNow();

  const referenceDate = options?.referenceDate || kst.dateStr;
  if (!isValidDateString(referenceDate)) {
    throw new Error("Invalid referenceDate: must be a valid YYYY-MM-DD date string");
  }

  if (referenceDate > kst.dateStr) {
    throw new Error(`Invalid referenceDate: referenceDate (${referenceDate}) cannot be in the future relative to current KST date (${kst.dateStr})`);
  }

  const expectedCutoff = subtractDays(referenceDate, 7);

  if (options?.cutoffDate !== undefined) {
    if (!isValidDateString(options.cutoffDate)) {
      throw new Error("Invalid cutoffDate: must be a valid YYYY-MM-DD date string");
    }
    if (options.cutoffDate !== expectedCutoff) {
      throw new Error(
        `Invalid cutoffDate: supplied cutoffDate (${options.cutoffDate}) does not match exact 7-day retention cutoff (${expectedCutoff}) for referenceDate (${referenceDate})`
      );
    }
  }

  const cutoffDate = expectedCutoff;

  const limit = options?.limit ?? 1000;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("Invalid limit: limit must be an integer between 1 and 5000");
  }

  const db = createServiceClient();

  // 1. Execute atomic RPC purge_v3_retention_batch (Fail closed: No direct table delete fallback)
  const { data: rpcRes, error: rpcErr } = await db.rpc("purge_v3_retention_batch", {
    p_cutoff_date: cutoffDate,
    p_limit: limit,
  });

  if (rpcErr) {
    throw new Error(`RPC purge_v3_retention_batch execution failed: ${rpcErr.message}`);
  }

  if (!rpcRes || typeof rpcRes !== "object") {
    throw new Error("RPC purge_v3_retention_batch returned unexpected invalid data");
  }

  const correctedDeleted = Number((rpcRes as any).corrected_deleted || 0);
  const rawDeleted = Number((rpcRes as any).raw_deleted || 0);

  // 2. Check if more expired rows exist in either dataset for observability
  const { count: remainingCorrected, error: corrErr } = await db
    .from("corrected_daily_conversations_v3")
    .select("id", { count: "exact", head: true })
    .lte("business_date", cutoffDate);

  if (corrErr) {
    throw new Error(`Failed to query remaining corrected_daily_conversations_v3 count: ${corrErr.message}`);
  }

  const { count: remainingRaw, error: rawErr } = await db
    .from("raw_daily_conversations_v3")
    .select("id", { count: "exact", head: true })
    .lte("business_date", cutoffDate);

  if (rawErr) {
    throw new Error(`Failed to query remaining raw_daily_conversations_v3 count: ${rawErr.message}`);
  }

  const hasMore = (remainingCorrected ?? 0) > 0 || (remainingRaw ?? 0) > 0;

  return {
    success: true,
    referenceDate,
    cutoffDate,
    correctedDeleted,
    rawDeleted,
    limit,
    hasMore,
  };
}
