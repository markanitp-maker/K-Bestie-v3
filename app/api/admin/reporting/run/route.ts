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

  let p_cutoff_at: string | undefined;
  if (action === "collect" || action === "collect_and_generate") {
    // 관리자 수동 실행(execution_mode=manual, 이 라우트 자체가 그 전용 경로 —
    // requireAdmin()으로 서버에서 관리자 권한을 이미 검증했다)은 자동 Cron의
    // 17:55/23:55 KST 스케줄과 무관하게 대표님이 선택한 날짜·대상을 시간 제한
    // 없이 즉시 수집할 수 있어야 한다. 실제 자동 Cron 경로(app/api/batch/v3/
    // collection/enqueue/route.ts, BATCH_SECRET 인증)는 이 시간 제한을 자체
    // 코드로 강제하지 않고 Vercel Cron 스케줄 자체로만 통제하므로, 여기 있던
    // 17:55 이전 차단은 자동 경로 로직 재사용이 아니라 잘못 복제된 별도 규칙이었다
    // — 지금까지 그날 첫 수동 실행 시도가 항상 이 오탐으로 막혀 있었다.
    // cutoff는 enqueue_collection_jobs_v3 RPC의 p_cutoff_at <= now() 제약과
    // 맞춰 "선택 날짜가 이미 지났으면 자정, 아직 진행 중이면 지금"으로 잡는다.
    const nowUtc = new Date();
    const selectedDate = new Date(businessDate + "T00:00:00+09:00");
    const selectedNextDate = new Date(selectedDate.getTime() + 24 * 3600000);

    p_cutoff_at = (nowUtc.getTime() >= selectedNextDate.getTime() ? selectedNextDate : nowUtc).toISOString();
  }

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
      // Pass explicit as-of-now cutoff so manual collection is immediately claimable!
      const { error: colErr } = await db.rpc("enqueue_collection_jobs_v3", {
        p_collection_phase: 2,
        p_business_date: businessDate,
        p_execution_id: executionId,
        p_child_id: c.id,
        p_cutoff_at: p_cutoff_at,
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
