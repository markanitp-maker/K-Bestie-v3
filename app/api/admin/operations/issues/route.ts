// 요청서 019 §3-1, §3-2, §3-15 — 관리자 대화 QA 이슈 목록 조회 API
//
// 관리자 권한(requireAdmin)이 필수이며, 특정 businessDate 또는 최신 Run의
// 이슈 목록 및 메타데이터를 반환한다.
// 대화 원문은 반환하지 않고, 익명화된 200자 이내 excerpt만 내보낸다.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVERITY_ORDER: Record<string, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const db = createServiceClient();
    const { searchParams } = new URL(req.url);
    const businessDate = searchParams.get("businessDate")?.trim();

    // 1. 최근 30일 availableDates 조회
    const { data: dateRows } = await db
      .from("daily_conversation_qa_runs")
      .select("business_date")
      .order("business_date", { ascending: false })
      .limit(100);

    const availableDates = Array.from(
      new Set((dateRows ?? []).map((r) => r.business_date).filter(Boolean))
    ).slice(0, 30);

    // 2. 대상 Run 조회 (businessDate 지정 시 해당 날짜의 최신 Run, 미지정 시 전체 중 가장 최신 Run)
    let runQuery = db
      .from("daily_conversation_qa_runs")
      .select("*");

    if (businessDate) {
      runQuery = runQuery.eq("business_date", businessDate).order("created_at", { ascending: false });
    } else {
      runQuery = runQuery.order("business_date", { ascending: false }).order("created_at", { ascending: false });
    }

    const { data: run, error: runError } = await runQuery.limit(1).maybeSingle();

    if (runError) {
      return NextResponse.json(
        { error: `Run 조회 실패: ${runError.message}` },
        { status: 500 }
      );
    }

    // Run 이 없으면 200 에 빈 객체 반환 (404 금지 — "아직 점검 기록 없음"은 정상 상태)
    if (!run) {
      return NextResponse.json({
        run: null,
        issues: [],
        availableDates,
      });
    }

    // 3. 이슈 목록 조회 (run_id 기준)
    const { data: rawIssues, error: issuesError } = await db
      .from("daily_conversation_qa_issues")
      .select("*")
      .eq("run_id", run.id);

    if (issuesError) {
      return NextResponse.json(
        { error: `이슈 목록 조회 실패: ${issuesError.message}` },
        { status: 500 }
      );
    }

    // severity 순(BLOCKER 먼저) → event_count 내림차순 정렬
    const sortedIssues = (rawIssues ?? []).sort((a, b) => {
      const orderA = SEVERITY_ORDER[a.severity] ?? 99;
      const orderB = SEVERITY_ORDER[b.severity] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return (b.event_count ?? 0) - (a.event_count ?? 0);
    });

    // 아동 대화 원문 노출 방지: representative_examples의 excerpt(200자 이내)만 유지
    const issues = sortedIssues.map((issue) => ({
      id: issue.id,
      run_id: issue.run_id,
      business_date: issue.business_date,
      taxonomy_code: issue.taxonomy_code,
      severity: issue.severity,
      trend_status: issue.trend_status,
      title: issue.title,
      summary: issue.summary,
      event_count: issue.event_count ?? 0,
      affected_children_count: issue.affected_children_count ?? 0,
      affected_sessions_count: issue.affected_sessions_count ?? 0,
      analyzed_sessions: issue.analyzed_sessions ?? 0,
      prev_event_count: issue.prev_event_count ?? null,
      prev_affected_sessions: issue.prev_affected_sessions ?? null,
      first_detected_at: issue.first_detected_at,
      last_detected_at: issue.last_detected_at,
      representative_examples: Array.isArray(issue.representative_examples)
        ? issue.representative_examples.map((ex: any) => ({
            sessionId: ex?.sessionId ?? null,
            messageId: ex?.messageId ?? null,
            excerpt: typeof ex?.excerpt === "string" ? ex.excerpt.slice(0, 200) : "",
          }))
        : [],
      session_ids: issue.session_ids ?? [],
      message_ids: issue.message_ids ?? [],
      root_cause_hint: issue.root_cause_hint ?? null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }));

    return NextResponse.json({
      run: {
        id: run.id,
        status: run.status,
        window_start: run.window_start,
        window_end: run.window_end,
        business_date: run.business_date,
        trigger_source: run.trigger_source,
        total_children: run.total_children ?? 0,
        total_sessions: run.total_sessions ?? 0,
        mission_sessions: run.mission_sessions ?? 0,
        free_chat_sessions: run.free_chat_sessions ?? 0,
        analyzed_sessions: run.analyzed_sessions ?? 0,
        skipped_test_sessions: run.skipped_test_sessions ?? 0,
        total_messages: run.total_messages ?? 0,
        analyzed_messages: run.analyzed_messages ?? 0,
        issue_count: run.issue_count ?? 0,
        blocker_count: run.blocker_count ?? 0,
        high_count: run.high_count ?? 0,
        medium_count: run.medium_count ?? 0,
        low_count: run.low_count ?? 0,
        failed_session_count: run.failed_session_count ?? 0,
        error_summary: run.error_summary ?? null,
        started_at: run.started_at,
        completed_at: run.completed_at,
        created_at: run.created_at,
      },
      issues,
      availableDates,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
