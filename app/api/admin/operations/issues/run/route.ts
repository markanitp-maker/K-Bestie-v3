// 요청서 019 §3-20 — 관리자 `지금 다시 점검` 수동 실행 엔드포인트
//
// 관리자 권한(requireAdmin)이 필수이며, 수동 트리거(triggerSource: "manual")로
// 직전 24시간 대화 자동 QA를 실행한다.
// execution_key 중복 방지(§3-21) 메커니즘이 있어 크론과 동시에 실행되거나
// 관리자가 연속 호출하더라도 동일 window에 대해 중복 Run/이슈가 생성되지 않고 안전하다.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";
import { runDailyConversationQa } from "@/lib/dailyQa/runService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 관리자 권한 검증 (lib/admin/requireAdmin.ts)
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const db = createServiceClient();
    const nowIso = new Date().toISOString();

    // 중복 Run 방지(§3-21):
    // execution_key(daily-qa:windowEnd)를 통한 UNIQUE 제약조건으로 인해 크론 실행과 겹치거나
    // 관리자가 중복 클릭하더라도 동일 시간대 window에 대해 새 Run이 중복 생성되지 않고
    // 기존 Run 결과를 안전하게 반환한다.
    const result = await runDailyConversationQa({
      db,
      nowIso,
      triggerSource: "manual",
      judge: undefined,
    });

    return NextResponse.json({
      success: result.status === "SUCCESS" || result.status === "PARTIAL",
      runId: result.runId,
      status: result.status,
      businessDate: result.businessDate,
      issueCount: result.issueCount,
      analyzedSessions: result.analyzedSessions,
      skippedTestSessions: result.skippedTestSessions,
      isExistingRun: result.isExistingRun,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
