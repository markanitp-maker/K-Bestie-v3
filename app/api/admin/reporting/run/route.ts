import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { runContextCorrectionPipeline } from "@/lib/batch/contextCorrection";
import { generateDailyReports } from "@/lib/batch/generateDailyReports";
import { isRealCalendarDate } from "@/lib/admin/reportingDateValidation";
import { processSpecificCollectionJobV3 } from "@/lib/batch/collection";
import { processSpecificContextCorrectionJobV3 } from "@/lib/batch/contextCorrectionV3";
import { processSpecificDailyReportJobV3 } from "@/lib/batch/dailyReportV3";
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
  const { data: v3Control } = await db.from("pipeline_v3_control").select("enabled").eq("id", 1).single();
  const isV3Enabled = v3Control?.enabled === true;

  let childId = null;
  if (target.scope === "single") {
    childId = target.childId;
    if (!childId) return NextResponse.json({ error: "Missing childId" }, { status: 400 });
    const { data } = await db.from("child_profiles").select("id").eq("id", childId).single();
    if (!data) return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  const executionId = crypto.randomUUID();

  // V3 LOGIC
  if (isV3Enabled) {
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const cutoffAt = businessDate === todayStr ? new Date().toISOString() : `${businessDate}T23:59:59+09:00`;
    const workerId = `admin_manual_${Date.now()}`;

    if (target.scope === "all") {
      // Get all active children (those with messages today)
      // We will let enqueue RPC do the filtering for Collection, but for generation we just enqueue for those who have corrected data.
      let enqueuedChildIds: string[] = [];
      
      if (action === "collect" || action === "collect_and_generate") {
        const { data: sessions } = await db.from("chat_sessions")
          .select("child_id")
          .gte("started_at", `${businessDate}T00:00:00+09:00`)
          .lte("started_at", `${businessDate}T23:59:59+09:00`);
        
        const cIds = Array.from(new Set((sessions || []).map((s: any) => s.child_id)));
        enqueuedChildIds = cIds;
        
        for (const cid of cIds) {
          const idempotencyKey = `collection_manual_${cid}_${businessDate}_2_${new Date(cutoffAt).getTime() / 1000}`;
          await db.from('pipeline_jobs').upsert({
            id: crypto.randomUUID(),
            job_type: 'collection_2',
            child_id: cid,
            business_date: businessDate,
            collection_phase: 2,
            cutoff_at: cutoffAt,
            execution_id: executionId,
            status: 'pending',
            attempt_count: 0,
            priority: 1,
            idempotency_key: idempotencyKey
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        }
      }

      if (action === "generate") {
        // Find children with completed corrected V3
        const { data: corr } = await db.from("corrected_daily_conversations_v3")
          .select("child_id")
          .eq("business_date", businessDate)
          .eq("correction_status", "completed");
        
        const cIds = Array.from(new Set((corr || []).map((c: any) => c.child_id)));
        enqueuedChildIds = cIds;

        for (const cid of cIds) {
          const idempotencyKey = `daily_report_${cid}_${businessDate}`;
          await db.from('pipeline_jobs').upsert({
            id: crypto.randomUUID(),
            job_type: 'daily_report',
            child_id: cid,
            business_date: businessDate,
            execution_id: executionId,
            status: 'pending',
            attempt_count: 0,
            priority: 1,
            idempotency_key: idempotencyKey
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        }
      }

      // Return immediately for polling
      return NextResponse.json({
        ok: true,
        v3: true,
        execution_id: executionId,
        enqueuedCount: enqueuedChildIds.length
      });
    } else {
      // SINGLE CHILD - Synchronous
      try {
        if (action === "collect" || action === "collect_and_generate") {
          const idempotencyKey = `collection_manual_${childId}_${businessDate}_2_${new Date(cutoffAt).getTime() / 1000}`;
          await db.from('pipeline_jobs').upsert({
            id: crypto.randomUUID(),
            job_type: 'collection_2',
            child_id: childId,
            business_date: businessDate,
            collection_phase: 2,
            cutoff_at: cutoffAt,
            execution_id: executionId,
            status: 'pending',
            attempt_count: 0,
            priority: 1,
            idempotency_key: idempotencyKey
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          const colRes = await processSpecificCollectionJobV3(2, childId!, businessDate, workerId);
          if (!colRes.success && colRes.reason !== 'NO_PENDING_JOB') throw new Error(`Collection failed: ${colRes.reason}`);
        }

        if (action === "collect_and_generate") {
          const corRes = await processSpecificContextCorrectionJobV3(childId!, businessDate, workerId);
          if (!corRes.success && corRes.reason !== 'NO_PENDING_JOB') throw new Error(`Correction failed: ${corRes.reason}`);
        }

        if (action === "generate" || action === "collect_and_generate") {
          if (action === "generate") {
            const idempotencyKey = `daily_report_${childId}_${businessDate}`;
            await db.from('pipeline_jobs').upsert({
              id: crypto.randomUUID(),
              job_type: 'daily_report',
              child_id: childId,
              business_date: businessDate,
              execution_id: executionId,
              status: 'pending',
              attempt_count: 0,
              idempotency_key: idempotencyKey
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
          }
          const repRes = await processSpecificDailyReportJobV3(childId!, businessDate, workerId);
          if (!repRes.success && repRes.reason !== 'NO_PENDING_JOB') {
             // If manual generate fails due to NO_MESSAGES etc., throw it
             throw new Error(`Report generation failed: ${repRes.reason}`);
          }
        }

        return NextResponse.json({
          ok: true,
          v3: true,
          action,
          target,
          collect: { collected: 1, errors: [] },
          generate: { created: [childId], errors: [] }
        });

      } catch (e: any) {
        return NextResponse.json({ error: e.message, action, target }, { status: 500 });
      }
    }
  }

  // --- V2 LEGACY LOGIC BELOW ---
  let collectResult = undefined;
  let generateResult = undefined;

  if (action === "collect" || action === "collect_and_generate") {
    try {
      if (childId) {
        const { data: sessions } = await db.from("chat_sessions")
          .select("id")
          .eq("child_id", childId)
          .gte("started_at", `${businessDate}T00:00:00+09:00`)
          .lte("started_at", `${businessDate}T23:59:59+09:00`);
        
        const sessionIds = (sessions || []).map((s: any) => s.id);
        if (sessionIds.length > 0) {
          collectResult = await runContextCorrectionPipeline(businessDate, sessionIds);
        } else {
          collectResult = { collected: 0, corrected: 0, unchanged: 0, uncertain: 0, rejected: 0, errors: [] };
        }
      } else {
        collectResult = await runContextCorrectionPipeline(businessDate);
      }
    } catch (e: any) {
      return NextResponse.json({ error: `Collect error: ${e.message}`, action, businessDate, target }, { status: 500 });
    }
  }

  if (action === "generate" || action === "collect_and_generate") {
    try {
      let rawQuery = db.from("raw_daily_conversations").select("id").eq("business_date", businessDate).limit(1);
      if (childId) rawQuery = rawQuery.eq("child_id", childId);
      
      const { data: rawData } = await rawQuery;
      if (!rawData || rawData.length === 0) {
        return NextResponse.json({ error: "먼저 즉시 대화 수집을 실행해 주세요. (수집된 대화 없음)", action, businessDate, target }, { status: 400 });
      }

      generateResult = await generateDailyReports(businessDate, childId || undefined);
    } catch (e: any) {
      return NextResponse.json({ error: `Generate error: ${e.message}`, action, businessDate, target, collect: collectResult }, { status: 500 });
    }
  }

  const hasPartialErrors =
    (collectResult?.errors?.length ?? 0) > 0 || (generateResult?.errors?.length ?? 0) > 0;

  return NextResponse.json({
    ok: true,
    partialFailure: hasPartialErrors,
    businessDate,
    action,
    target,
    collect: collectResult,
    generate: generateResult ? {
      created: generateResult.created,
      skipped: generateResult.skipped,
      errorCount: generateResult.errors?.length || 0,
      errors: generateResult.errors
    } : undefined
  });
}
