import { createServiceClient } from "@/lib/supabase/server";

export interface ChatMessageCleanupOptions {
  cutoffAt?: string;
  limit?: number;
  force?: boolean;
}

export interface ChatMessageCleanupResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  deleted: number;
  limit: number;
  cutoffAt: string;
  hasMore: boolean;
  remainingEstimate: number;
  kstHour?: number;
}

/**
 * Returns current KST (Asia/Seoul) date string ("YYYY-MM-DD"), hour (0-23), and ISO string.
 */
export function getKstNow(): { dateStr: string; hour: number; isoStr: string } {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const hourStr = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }).format(now);
  const hour = parseInt(hourStr, 10) % 24;
  return {
    dateStr,
    hour,
    isoStr: now.toISOString(),
  };
}

function isValidIsoDateTimeString(isoStr: string): boolean {
  if (typeof isoStr !== "string" || !isoStr.trim()) return false;
  const timestamp = Date.parse(isoStr);
  return !isNaN(timestamp);
}

/**
 * Executes bounded cleanup for original chat_messages.
 * Rules:
 * 1. Runs only after 01:00 KST (hour >= 1) in normal production execution.
 * 2. Force flag is strictly rejected in production (NODE_ENV === 'production').
 * 3. Deletes ONLY rows with collected_at IS NOT NULL and collected_at <= cutoffAt.
 * 4. Never deletes collected_at IS NULL messages.
 * 5. Executes via atomic RPC cleanup_chat_messages_v3 in deterministic oldest-first chunks (collected_at, then id).
 * 6. Fails closed: direct-table DELETE fallbacks are prohibited.
 */
export async function runOriginalChatMessageCleanup(
  options?: ChatMessageCleanupOptions
): Promise<ChatMessageCleanupResult> {
  const kst = getKstNow();

  const limit = options?.limit ?? 1000;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("Invalid limit: limit must be an integer between 1 and 5000");
  }

  const cutoffAt = options?.cutoffAt || kst.isoStr;
  if (!isValidIsoDateTimeString(cutoffAt)) {
    throw new Error("Invalid cutoffAt: must be a valid ISO date-time string");
  }

  const now = new Date();
  if (Date.parse(cutoffAt) > now.getTime()) {
    throw new Error("Invalid cutoffAt: cutoffAt cannot be in the future relative to server time");
  }

  const force = options?.force ?? false;
  const isProduction = process.env.NODE_ENV === "production";

  if (force && isProduction) {
    throw new Error("Force flag is strictly prohibited in production environment");
  }

  // 1. Time check: Must run after 01:00 KST unless force === true in non-production
  if (kst.hour < 1 && !force) {
    return {
      success: true,
      skipped: true,
      reason: "Original chat_messages cleanup runs only after 01:00 KST",
      deleted: 0,
      limit,
      cutoffAt,
      hasMore: false,
      remainingEstimate: 0,
      kstHour: kst.hour,
    };
  }

  const db = createServiceClient();

  // 2. Execute atomic RPC cleanup_chat_messages_v3 (Fail closed: No direct table delete fallback)
  const { data: rpcDeleted, error: rpcErr } = await db.rpc("cleanup_chat_messages_v3", {
    p_cutoff_at: cutoffAt,
    p_limit: limit,
  });

  if (rpcErr) {
    throw new Error(`RPC cleanup_chat_messages_v3 execution failed: ${rpcErr.message}`);
  }

  if (typeof rpcDeleted !== "number") {
    throw new Error("RPC cleanup_chat_messages_v3 returned unexpected invalid data type");
  }

  const deleted = rpcDeleted;

  // 3. Count remaining eligible messages for observability
  const { count: remaining, error: countErr } = await db
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .not("collected_at", "is", null)
    .lte("collected_at", cutoffAt);

  if (countErr) {
    throw new Error(`Failed to query remaining chat_messages count: ${countErr.message}`);
  }

  const remainingCount = remaining ?? 0;

  return {
    success: true,
    skipped: false,
    deleted,
    limit,
    cutoffAt,
    hasMore: remainingCount > 0,
    remainingEstimate: remainingCount,
    kstHour: kst.hour,
  };
}
