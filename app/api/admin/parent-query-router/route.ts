import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getSupabaseTarget } from "@/lib/supabase/env";
import { RED_RULES as RED_RULES_G1 } from "@/lib/plan/parentQueryRouterGrade1";
import { RED_RULES as RED_RULES_G2 } from "@/lib/plan/parentQueryRouterGrade2";
import { RED_RULES as RED_RULES_G3 } from "@/lib/plan/parentQueryRouterGrade3";
import { RED_RULES as RED_RULES_G4 } from "@/lib/plan/parentQueryRouterGrade4";
import { RED_RULES as RED_RULES_G5 } from "@/lib/plan/parentQueryRouterGrade5";
import { RED_RULES as RED_RULES_G6 } from "@/lib/plan/parentQueryRouterGrade6";

export const runtime = "nodejs";

// requests/request-parent-query-router-grade{1,2,3,4,5,6}-v1.md §14 — 읽기 전용 통계.
// parent_query_router_events(모든 판정, 원문 없음)와 parent_questions(GREEN 확정 후
// 실제 등록된 질문의 생애주기)를 조합해 필요한 지표를 계산한다. 운영자가 규칙을
// 즉시 수정하는 기능은 제공하지 않는다(§14 금지 항목).
//
// 학년마다 fallback(default RED) 규칙의 rule_id가 다르다(1/2/3/4학년은 R-06, 5/6학년은
// 외모·이성·SNS 3개가 추가돼 R-09) — 하드코딩된 "R-06"으로는 5/6학년 default-red 비율이
// 항상 0으로 잘못 계산된다. 각 학년 설정에서 실제 fallback id를 조회해 사용한다.
const RED_RULES_BY_GRADE: Record<number, readonly { id: string; area: string }[]> = {
  1: RED_RULES_G1,
  2: RED_RULES_G2,
  3: RED_RULES_G3,
  4: RED_RULES_G4,
  5: RED_RULES_G5,
  6: RED_RULES_G6,
};

const POLICY_VERSION_BY_GRADE: Record<number, string> = {
  1: "PQR-G1-1.0",
  2: "PQR-G2-1.0",
  3: "PQR-G3-1.0",
  4: "PQR-G4-1.0",
  5: "PQR-G5-1.0",
  6: "PQR-G6-1.0",
};

// k-chat/route.ts의 GRADE_ROUTER_CONFIG와 동일한 기본값(표시 전용 — 실제 게이팅 결정은
// route.ts에서만 한다). 4학년만 이미 전체 활성화된 기준본이다(§13).
const DEFAULT_PRODUCTION_ENABLED: Record<number, boolean> = { 1: false, 2: false, 3: false, 4: true, 5: false, 6: false };
const PRODUCTION_ENABLED_ENV_VAR: Record<number, string> = {
  1: "PARENT_QUERY_ROUTER_GRADE1_PRODUCTION_ENABLED",
  2: "PARENT_QUERY_ROUTER_GRADE2_PRODUCTION_ENABLED",
  3: "PARENT_QUERY_ROUTER_GRADE3_PRODUCTION_ENABLED",
  4: "PARENT_QUERY_ROUTER_GRADE4_PRODUCTION_ENABLED",
  5: "PARENT_QUERY_ROUTER_GRADE5_PRODUCTION_ENABLED",
  6: "PARENT_QUERY_ROUTER_GRADE6_PRODUCTION_ENABLED",
};

function fallbackRuleIdForGrade(grade: number): string | null {
  const rules = RED_RULES_BY_GRADE[grade];
  return rules?.find((r) => r.area === "fallback")?.id ?? null;
}

function isGradeProductionEnabled(grade: number): boolean {
  const envVar = PRODUCTION_ENABLED_ENV_VAR[grade];
  const override = envVar ? process.env[envVar] : undefined;
  if (override !== undefined) return override === "true";
  return DEFAULT_PRODUCTION_ENABLED[grade] ?? false;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const service = createServiceClient();

  const { data: events, error: eventsErr } = await service
    .from("parent_query_router_events")
    .select("route, area, rule_id, grade, question_count, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (eventsErr) {
    console.error("[admin/parent-query-router] events query failed:", eventsErr);
    return NextResponse.json({ error: eventsErr.message }, { status: 500 });
  }

  const { data: registered, error: regErr } = await service
    .from("parent_questions")
    .select("status, source_grade, router_rule_id, router_area")
    .eq("source", "PARENT_QUERY_ROUTER");

  if (regErr) {
    console.error("[admin/parent-query-router] parent_questions query failed:", regErr);
    return NextResponse.json({ error: regErr.message }, { status: 500 });
  }

  const grades = [1, 2, 3, 4, 5, 6];
  const perGrade = grades.map((grade) => {
    const gradeEvents = (events ?? []).filter((e) => e.grade === grade);
    const gradeRegistered = (registered ?? []).filter((r) => r.source_grade === grade);

    const routeCounts: Record<string, number> = {};
    const ruleCounts: Record<string, number> = {};
    let multiQuestionEvents = 0;
    for (const e of gradeEvents) {
      routeCounts[e.route] = (routeCounts[e.route] ?? 0) + 1;
      if (e.rule_id) ruleCounts[e.rule_id] = (ruleCounts[e.rule_id] ?? 0) + 1;
      if (e.question_count > 1) multiQuestionEvents += 1;
    }
    const totalRed = routeCounts["RED"] ?? 0;
    const fallbackId = fallbackRuleIdForGrade(grade);
    const defaultRedCount = fallbackId ? ruleCounts[fallbackId] ?? 0 : 0;
    const defaultRedRatio = totalRed > 0 ? defaultRedCount / totalRed : 0;

    const registrationOutcomeCounts: Record<string, number> = {};
    for (const r of gradeRegistered) {
      registrationOutcomeCounts[r.status] = (registrationOutcomeCounts[r.status] ?? 0) + 1;
    }

    return {
      grade,
      policyVersion: POLICY_VERSION_BY_GRADE[grade],
      productionEnabled: isGradeProductionEnabled(grade),
      totalEvents: gradeEvents.length,
      routeCounts,
      ruleCounts,
      defaultRedCount,
      defaultRedRatio,
      multiQuestionEvents,
      totalRegistered: gradeRegistered.length,
      registrationOutcomeCounts,
    };
  });

  return NextResponse.json({
    supabaseTarget: getSupabaseTarget(),
    totalEvents: (events ?? []).length,
    totalRegistered: (registered ?? []).length,
    perGrade,
    // §8.3 — Crisis 규칙은 코드에는 존재하지만 임상 승인 전까지 특화 UI/문구는 잠겨있다.
    // 이 값은 코드가 아니라 운영 사실을 알리는 정적 플래그다(전체 학년 공통).
    crisisClinicallyReviewed: process.env.PARENT_QUERY_ROUTER_CRISIS_CLINICAL_APPROVED === "true",
    note: "LLM 후보 대비 최종 판정 불일치 건수·false-Green 검토 후보는 이번 범위에서 제외됨(별도 추적 인프라 필요, 대표님께 별도 보고).",
  });
}
