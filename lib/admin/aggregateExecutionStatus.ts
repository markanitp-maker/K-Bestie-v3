import { SupabaseClient } from "@supabase/supabase-js";

export interface AggregateState {
  summary: {
    memory: { success: number; skipped: number; failed: number };
    report: { created: number; skipped: number; failed: number };
  };
  statuses: any[];
  isComplete: boolean;
  partialFailure: boolean;
}

export async function aggregateExecutionStatus(
  db: SupabaseClient,
  executionId: string,
  action?: string | null
): Promise<AggregateState> {
  const { data: execItems, error: execErr } = await db
    .from("pipeline_execution_items")
    .select("child_id, job_type, collection_phase, status, outcome, error_code, error_summary, completed_at, item_key")
    .eq("execution_id", executionId);

  if (execErr) {
    throw new Error(`Failed to query execution items: ${execErr.message}`);
  }

  const statusByChild = new Map<string, any>();
  const summary = {
    memory: { success: 0, skipped: 0, failed: 0 },
    report: { created: 0, skipped: 0, failed: 0 },
  };

  const allChildIds = new Set<string>();
  (execItems || []).forEach((item: any) => allChildIds.add(item.child_id));

  for (const childId of allChildIds) {
    statusByChild.set(childId, { childId });
  }

  for (const item of execItems || []) {
    const state = statusByChild.get(item.child_id)!;
    const isNoConv = item.outcome === "NO_CONVERSATION" || item.error_summary === "NO_CONVERSATION";
    const isAlreadyComp = item.outcome === "ALREADY_COMPLETED";
    const isSkipped = item.outcome === "SKIPPED";

    let uiStatus = "대기";
    if (item.status === "processing") uiStatus = "처리 중";
    else if (item.status === "completed") {
      if (isNoConv) uiStatus = "건너뜀(대화 없음)";
      else if (isAlreadyComp) uiStatus = "이미 완료됨";
      else if (isSkipped) uiStatus = "건너뜀";
      else uiStatus = "완료";
    } else if (item.status === "failed") {
      uiStatus = "실패";
    } else if (item.status === "retry_wait") {
      uiStatus = "재시도 대기";
    }

    if (item.job_type === "collection_1" || (item.job_type === "collection_2" && item.collection_phase === 1)) {
      state.collection1 = uiStatus;
      state.collection1RawStatus = item.status;
      state.collection1Outcome = item.outcome;
      if (item.error_code) state.collection1Error = item.error_code;
    } else if (item.job_type === "collection_2" || item.job_type?.startsWith("collection_")) {
      state.collection2 = uiStatus;
      state.collectionRawStatus = item.status;
      state.collectionOutcome = item.outcome;
      if (item.error_code) state.collectionError = item.error_code;
    } else if (item.job_type === "context_correction") {
      state.correction = uiStatus;
      state.correctionRawStatus = item.status;
      state.correctionOutcome = item.outcome;
      if (item.error_code) state.correctionError = item.error_code;
    } else if (item.job_type === "memory_batch") {
      state.memory = uiStatus;
      state.memoryRawStatus = item.status;
      state.memoryOutcome = item.outcome;
      if (item.error_code) state.memoryError = item.error_code;

      if (item.status === "completed") {
        if (isNoConv || isAlreadyComp || isSkipped) summary.memory.skipped++;
        else summary.memory.success++;
      } else if (item.status === "failed") {
        summary.memory.failed++;
      }
    } else if (item.job_type === "daily_report") {
      state.report = uiStatus;
      state.reportRawStatus = item.status;
      state.reportOutcome = item.outcome;
      if (item.error_code) state.reportError = item.error_code;

      if (item.status === "completed") {
        if (isNoConv || isAlreadyComp || isSkipped) summary.report.skipped++;
        else summary.report.created++;
      } else if (item.status === "failed") {
        summary.report.failed++;
      }
    }
  }

  const statuses = Array.from(statusByChild.values());
  const isTerminal = (st?: string) => st === "completed" || st === "failed";

  let isComplete = false;
  if (statuses.length > 0) {
    isComplete = statuses.every((s) => {
      const colFailed = s.collectionRawStatus === "failed";
      const corFailed = s.correctionRawStatus === "failed";
      const memFailed = s.memoryRawStatus === "failed";
      const upstreamFailed = colFailed || corFailed;

      if (action === "collect") {
        return isTerminal(s.collectionRawStatus);
      }
      if (action === "generate") {
        return isTerminal(s.memoryRawStatus) && isTerminal(s.reportRawStatus);
      }
      if (action === "collect_and_generate") {
        if (upstreamFailed) return true;
        return (
          isTerminal(s.collectionRawStatus) &&
          isTerminal(s.correctionRawStatus) &&
          isTerminal(s.memoryRawStatus) &&
          isTerminal(s.reportRawStatus)
        );
      }

      const cDone = !s.collectionRawStatus || isTerminal(s.collectionRawStatus);
      const corDone = !s.correctionRawStatus || isTerminal(s.correctionRawStatus);
      const mDone = upstreamFailed || !s.memoryRawStatus || isTerminal(s.memoryRawStatus);
      const rDone = upstreamFailed || !s.reportRawStatus || isTerminal(s.reportRawStatus);
      return cDone && corDone && mDone && rDone;
    });
  }

  const partialFailure = statuses.some(
    (s) =>
      s.collectionRawStatus === "failed" ||
      s.collection1RawStatus === "failed" ||
      s.correctionRawStatus === "failed" ||
      s.memoryRawStatus === "failed" ||
      s.reportRawStatus === "failed"
  );

  return {
    summary,
    statuses,
    isComplete,
    partialFailure,
  };
}
