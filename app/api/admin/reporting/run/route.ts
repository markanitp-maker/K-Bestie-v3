import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { runContextCorrectionPipeline } from "@/lib/batch/contextCorrection";
import { generateDailyReports } from "@/lib/batch/generateDailyReports";
import { isRealCalendarDate } from "@/lib/admin/reportingDateValidation";

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

  let childId = null;
  if (target.scope === "single") {
    childId = target.childId;
    if (!childId) return NextResponse.json({ error: "Missing childId" }, { status: 400 });
    const { data } = await db.from("child_profiles").select("id").eq("id", childId).single();
    if (!data) return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  let collectResult = undefined;
  let generateResult = undefined;

  // COLLECT
  if (action === "collect" || action === "collect_and_generate") {
    try {
      if (childId) {
        // Find session ids for this child on this date
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

  // GENERATE
  if (action === "generate" || action === "collect_and_generate") {
    try {
      // Check if raw_daily_conversations exists
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

  // DASHBOARD STATUS
  let dashboardStatus = undefined;
  if (childId && (action === "generate" || action === "collect_and_generate")) {
    const { data: report } = await db.from("daily_reports")
      .select("*")
      .eq("child_id", childId)
      .eq("business_date", businessDate)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (report) {
      const fields = [
        report.school_academy_life,
        report.peer_friendship,
        report.emotion_hint,
        report.interests_preferences,
        report.study_concerns,
        report.digital_content_interests,
        report.future_dreams,
        report.recurring_stories
      ];
      dashboardStatus = [{
        childId,
        nonNullFieldCount: fields.filter((f: any) => f && String(f).trim().length > 0).length
      }];
    }
  }

  // codex 리뷰 지적: collect/generate 각각 부분 오류(errors 배열)가 있어도 지금까지는
  // 전체 응답이 ok:true, UI는 "✅ 성공"으로만 표시해 아이별/세션별 실패가 성공으로
  // 오인될 수 있었다(실제로 QA 계정 실행에서 재현 - 8세션 중 2개가 collect 에러였는데
  // 전체는 성공으로 표시됨). 부분 실패 여부를 별도 필드로 명시한다.
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
    } : undefined,
    dashboardStatus
  });
}
