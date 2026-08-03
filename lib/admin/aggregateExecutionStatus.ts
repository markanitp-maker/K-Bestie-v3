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
    .select("child_id, job_type, collection_phase, status, outcome, error_code, error_summary, completed_at, item_key, business_date")
    .eq("execution_id", executionId);

  if (execErr) {
    throw new Error(`Failed to query execution items: ${execErr.message}`);
  }

  let businessDate = "";
  if (execItems && execItems.length > 0) {
    businessDate = execItems[0].business_date;
  }

  const { data: reports } = await db
    .from("daily_reports")
    .select("child_id, created_at, updated_at, generation_source, generation_version")
    .eq("business_date", businessDate)
    .is("deleted_at", null);

  const reportByChild = new Map<string, any>();
  for (const r of reports || []) {
    const existing = reportByChild.get(r.child_id);
    if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
      reportByChild.set(r.child_id, r);
    }
  }

  const statusByChild = new Map<string, any>();
  const summary = {
    memory: { success: 0, skipped: 0, failed: 0 },
    report: { created: 0, skipped: 0, failed: 0 },
  };

  const allChildIds = new Set<string>();
  (execItems || []).forEach((item: any) => allChildIds.add(item.child_id));

  const childIdsArray = Array.from(allChildIds);

  let profiles: any[] = [];
  if (childIdsArray.length > 0) {
    // child_profiles에는 deleted_at(소프트 삭제) 컬럼이 없다(2026-08-03 실측 확인 —
    // 하드 삭제만 존재). 대신 pipeline_execution_items에 child_id가 남아있는데
    // child_profiles에서 매칭되는 행이 없으면(하드 삭제됨) 이를 "삭제된 아이" 신호로
    // 사용한다(requests/061 §7 fallback).
    const { data } = await db
      .from("child_profiles")
      .select("id, name, member_id")
      .in("id", childIdsArray);
    if (data) profiles = data;
  }

  // child_profiles.member_id는 family_members.id(행 PK)를 가리키지 member_accounts.id
  // (실제 auth uid)를 직접 가리키지 않는다 — family_members를 한 단계 거쳐 실제 auth uid를
  // 구한 뒤 member_accounts를 조회해야 한다(app/api/admin/retention/children/route.ts와
  // 동일 버그·동일 수정, 근거는 app/api/admin/child-approval-requests/[id]/approve/route.ts
  // 의 실제 insert 순서).
  const memberRowIdsToFetch = Array.from(new Set(profiles.map(p => p.member_id).filter(Boolean)));
  const authUserIdByMemberRowId = new Map<string, string>();
  if (memberRowIdsToFetch.length > 0) {
    const { data: fmRows } = await db
      .from("family_members")
      .select("id, user_id")
      .eq("role", "child")
      .in("id", memberRowIdsToFetch);
    for (const fm of fmRows || []) {
      if (fm.user_id) authUserIdByMemberRowId.set(fm.id, fm.user_id);
    }
  }

  const authUserIds = Array.from(new Set(Array.from(authUserIdByMemberRowId.values())));
  let members: any[] = [];
  if (authUserIds.length > 0) {
    const { data } = await db
      .from("member_accounts")
      .select("id, username")
      .in("id", authUserIds);
    if (data) members = data;
  }

  const memberMap = new Map<string, string>();
  for (const m of members) {
    memberMap.set(m.id, m.username);
  }

  const profileMap = new Map<string, any>();
  for (const p of profiles) {
    const authUserId = p.member_id ? authUserIdByMemberRowId.get(p.member_id) : undefined;
    const username = authUserId ? memberMap.get(authUserId) : undefined;
    profileMap.set(p.id, {
      name: p.name,
      loginId: username || undefined,
    });
  }

  for (const childId of childIdsArray) {
    const p = profileMap.get(childId);
    statusByChild.set(childId, {
      childId,
      childName: p?.name,
      loginId: p?.loginId,
      isDeleted: !p, // child_profiles에 매칭 행이 없으면 하드 삭제된 아이로 간주
      maskedChildId: `${childId.substring(0, 8)}...`
    });
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
      // UPSTREAM_FAILED: 이 단계 자체가 실패한 게 아니라 앞단(수집/수집보정)
      // 실패로 대기 중단된 것이므로, 동일하게 "실패"로만 보이면 어느 단계가
      // 진짜 원인인지 관리자가 구분할 수 없다(2026-08-02 Production 장애
      // 보고에서 지적된 문제).
      uiStatus = item.outcome === "UPSTREAM_FAILED" ? "대기 — 앞단 실패" : "실패";
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

  const statuses = Array.from(statusByChild.values()).map(s => {
    const r = reportByChild.get(s.childId);
    if (r) {
      return {
        ...s,
        lastReportGeneratedAt: r.updated_at || r.created_at,
        generationSource: r.generation_source,
        generationVersion: r.generation_version
      };
    }
    return s;
  });
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
