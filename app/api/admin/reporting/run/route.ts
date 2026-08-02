import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { isRealCalendarDate } from "@/lib/admin/reportingDateValidation";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { businessDate, action, target } = body;

  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !isRealCalendarDate(businessDate)) {
    return NextResponse.json({ error: "Invalid businessDate" }, { status: 400 });
  }

  if (!["collect", "generate", "collect_and_generate"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (target?.scope !== "single" && target?.scope !== "all") {
    return NextResponse.json({ error: "Invalid target.scope (must be 'single' or 'all')" }, { status: 400 });
  }

  const db = createServiceClient();

  // Check V3 Control
  const { data: v3Control, error: ctrlErr } = await db
    .from("pipeline_v3_control")
    .select("enabled")
    .eq("id", 1)
    .single();

  if (ctrlErr) {
    return NextResponse.json({ error: `Control check error: ${ctrlErr.message}` }, { status: 500 });
  }
  
  if (v3Control?.enabled !== true) {
    return NextResponse.json({ error: "V3 pipeline is currently disabled" }, { status: 503 });
  }

  // 1. Snapshot explicit target set directly from child_profiles
  let targetChildren: { id: string }[] = [];
  if (target.scope === "single") {
    const childId = target.childId;
    if (!childId || typeof childId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(childId)) {
      return NextResponse.json({ error: "Invalid or missing childId UUID" }, { status: 400 });
    }
    const { data: child, error: childErr } = await db
      .from("child_profiles")
      .select("id")
      .eq("id", childId)
      .single();
    if (childErr || !child) {
      return NextResponse.json({ error: `Child lookup error: ${childErr?.message || "Child not found"}` }, { status: 404 });
    }
    targetChildren = [child];
  } else {
    const { data: allChildren, error: allChildErr } = await db
      .from("child_profiles")
      .select("id");
    if (allChildErr) {
      return NextResponse.json({ error: `Query children error: ${allChildErr.message}` }, { status: 500 });
    }
    targetChildren = allChildren || [];
  }

  const targetCount = targetChildren.length;
  if (targetCount === 0) {
    return NextResponse.json({
      ok: true,
      v3: true,
      execution_id: crypto.randomUUID(),
      action,
      target,
      targetCount: 0,
      completed: true,
      summary: "No targets found for the selected scope."
    });
  }

  // 관리자 수동 실행(execution_mode=manual, 이 라우트 자체가 그 전용 경로 —
  // requireAdmin()으로 서버에서 관리자 권한을 이미 검증했다)은 자동 Cron의
  // 17:55/23:55 KST 스케줄과 무관하게 대표님이 선택한 날짜·대상을 시간 제한
  // 없이 즉시 수집할 수 있어야 한다. 실제 자동 Cron 경로(app/api/batch/v3/
  // collection/enqueue/route.ts, BATCH_SECRET 인증)는 이 시간 제한을 자체
  // 코드로 강제하지 않고 Vercel Cron 스케줄 자체로만 통제하므로, 여기 있던
  // 17:55 이전 차단은 자동 경로 로직 재사용이 아니라 잘못 복제된 별도 규칙이었다.
  //
  // cutoff는 p_use_current_time: true로 넘겨 Postgres 자신의 now()로 계산하게 한다
  // (아래 RPC 호출부 참조). 예전에는 여기서 Node.js 서버의 로컬 시계로 "지금" 시각을
  // 계산해 p_cutoff_at으로 명시적으로 보냈는데, RPC의 `p_cutoff_at <= now()` 검증은
  // Postgres 서버의 시계로 판정하기 때문에 두 서버 시계 사이의 아주 작은(수백ms) 오차
  // 만으로도 "cutoff가 미래"로 오판되어 INVALID_CUTOFF로 매번 실패했다(2026-08-02
  // 실측 재현·확정). 클라이언트가 시각을 아예 계산하지 않고 의도(즉시 실행)만 전달하는
  // 이 방식이 서버 간 시계 차이에 원천적으로 영향받지 않는다(migration
  // 20260802230000_enqueue_collection_server_clock_cutoff.sql).
  //
  // 참고로 p_cutoff_at을 아예 안 보내고 기본값(v_sched_end = 다음날 00:00 KST)에
  // 맡기는 방법도 시도했으나, claim_collection_jobs_v3_for_execution이
  // `cutoff_at <= now()`를 "이 시각이 지나야 작업을 집을 수 있다"는 클레임 게이트로도
  // 재사용하고 있어 그 방식은 자정까지 즉시 실행이 막히는 새 회귀를 만들었다.

  const executionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // Determine required stages per action
  const stagesToSnapshot: { job_type: string; collection_phase?: number }[] = [];
  if (action === "collect") {
    stagesToSnapshot.push({ job_type: "collection_2", collection_phase: 2 });
  } else if (action === "generate") {
    stagesToSnapshot.push({ job_type: "memory_batch" }, { job_type: "daily_report" });
  } else if (action === "collect_and_generate") {
    stagesToSnapshot.push(
      { job_type: "collection_2", collection_phase: 2 },
      { job_type: "context_correction" },
      { job_type: "memory_batch" },
      { job_type: "daily_report" }
    );
  }

  // 2. Snapshot deterministic execution items BEFORE enqueue
  const snapshotItems: any[] = [];
  for (const c of targetChildren) {
    for (const stage of stagesToSnapshot) {
      const item_key = stage.job_type === "collection_2" ? "collection_2" : stage.job_type;
      snapshotItems.push({
        execution_id: executionId,
        child_id: c.id,
        business_date: businessDate,
        job_type: stage.job_type,
        collection_phase: stage.collection_phase || null,
        status: "pending",
        item_key,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
  }

  if (snapshotItems.length > 0) {
    const { error: snapErr } = await db.from("pipeline_execution_items").upsert(snapshotItems, { onConflict: "execution_id,child_id,item_key" });
    if (snapErr) {
      return NextResponse.json({ error: `Failed to snapshot execution items: ${snapErr.message}` }, { status: 500 });
    }
  }

  // 3. Process Action per Target
  for (const c of targetChildren) {
    if (action === "collect" || action === "collect_and_generate") {
      const { error: colErr } = await db.rpc("enqueue_collection_jobs_v3", {
        p_collection_phase: 2,
        p_business_date: businessDate,
        p_execution_id: executionId,
        p_child_id: c.id,
        p_use_current_time: true,
      });

      if (colErr) {
        // Enqueue error => mark FAILED with actual code/summary
        const { error: colFailErr } = await db.from("pipeline_execution_items").update({
          status: "failed",
          outcome: "FAILED",
          error_code: "ENQUEUE_FAILED",
          error_summary: colErr.message,
          completed_at: nowIso,
          updated_at: nowIso,
        }).eq("execution_id", executionId).eq("child_id", c.id).eq("item_key", "collection_2").not("status", "in", '("completed","failed")');
        
        if (colFailErr) {
          return NextResponse.json({ error: `Failed to record collection error for execution ${executionId}: ${colFailErr.message}` }, { status: 500 });
        }
        
        if (action === "collect_and_generate") {
          const { error: dsFailErr } = await db.from("pipeline_execution_items").update({
            status: "failed",
            outcome: "UPSTREAM_FAILED",
            error_code: "COLLECTION_ENQUEUE_FAILED",
            error_summary: "Collection enqueue failed, downstream cancelled.",
            completed_at: nowIso,
            updated_at: nowIso,
          }).eq("execution_id", executionId).eq("child_id", c.id).in("job_type", ["context_correction", "memory_batch", "daily_report"]).not("status", "in", '("completed","failed")');
          if (dsFailErr) {
            return NextResponse.json({ error: `Failed to record downstream errors for execution ${executionId}: ${dsFailErr.message}` }, { status: 500 });
          }
        }
      }
    }

    if (action === "generate") {
      // Check if corrected_daily_conversations_v3 is present
      const { data: corr, error: corrErr } = await db
        .from("corrected_daily_conversations_v3")
        .select("id")
        .eq("child_id", c.id)
        .eq("business_date", businessDate)
        .or("status.eq.completed,correction_status.eq.completed")
        .maybeSingle();

      if (corrErr) {
        // DB error on lookup => mark FAILED, NEVER NO_CONVERSATION
        const { error: memRepFailErr } = await db.from("pipeline_execution_items").update({
          status: "failed",
          outcome: "FAILED",
          error_code: "DB_LOOKUP_ERROR",
          error_summary: corrErr.message,
          completed_at: nowIso,
          updated_at: nowIso,
        }).eq("execution_id", executionId).eq("child_id", c.id).in("job_type", ["memory_batch", "daily_report"]).not("status", "in", '("completed","failed")');
        if (memRepFailErr) {
          return NextResponse.json({ error: `Failed to record db lookup error for execution ${executionId}: ${memRepFailErr.message}` }, { status: 500 });
        }
        continue;
      }

      if (!corr) {
        // Absent corrected V3 => Mark Memory and Report both NO_CONVERSATION completed so polling terminates
        const { error: noConvErr } = await db.from("pipeline_execution_items").update({
          status: "completed",
          outcome: "NO_CONVERSATION",
          error_summary: "NO_CONVERSATION",
          completed_at: nowIso,
          updated_at: nowIso,
        }).eq("execution_id", executionId).eq("child_id", c.id).in("job_type", ["memory_batch", "daily_report"]).not("status", "in", '("completed","failed")');
        if (noConvErr) {
          return NextResponse.json({ error: `Failed to record NO_CONVERSATION for execution ${executionId}: ${noConvErr.message}` }, { status: 500 });
        }
      } else {
        // Present corrected V3 => Enqueue Memory only; Report is created by Memory terminal transition
        const { error: memErr } = await db.rpc("enqueue_memory_batch_job_v3", {
          p_child_id: c.id,
          p_business_date: businessDate,
          p_execution_id: executionId,
        });

        if (memErr) {
          // Record memory enqueue failure
          const { error: memFailErr } = await db.from("pipeline_execution_items").update({
            status: "failed",
            outcome: "FAILED",
            error_code: "MEMORY_ENQUEUE_FAILED",
            error_summary: memErr.message,
            completed_at: nowIso,
            updated_at: nowIso,
          }).eq("execution_id", executionId).eq("child_id", c.id).eq("item_key", "memory_batch").not("status", "in", '("completed","failed")');
          if (memFailErr) {
            return NextResponse.json({ error: `Failed to record memory enqueue error for execution ${executionId}: ${memFailErr.message}` }, { status: 500 });
          }

          // Independently enqueue Report if Memory enqueue fails
          const { error: repErr } = await db.rpc("enqueue_daily_report_job_v3", {
            p_child_id: c.id,
            p_business_date: businessDate,
            p_execution_id: executionId,
          });

          if (repErr) {
            const { error: repFailErr } = await db.from("pipeline_execution_items").update({
              status: "failed",
              outcome: "FAILED",
              error_code: "REPORT_ENQUEUE_FAILED",
              error_summary: repErr.message,
              completed_at: nowIso,
              updated_at: nowIso,
            }).eq("execution_id", executionId).eq("child_id", c.id).eq("item_key", "daily_report").not("status", "in", '("completed","failed")');
            if (repFailErr) {
              return NextResponse.json({ error: `Failed to record report enqueue error for execution ${executionId}: ${repFailErr.message}` }, { status: 500 });
            }
          }
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    v3: true,
    execution_id: executionId,
    action,
    target,
    targetCount,
  });
}
