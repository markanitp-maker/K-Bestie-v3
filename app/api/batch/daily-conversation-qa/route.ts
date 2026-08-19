// 요청서 019 §3-17, §3-19 — 일일 24시간 대화 QA 크론용 배치 엔드포인트
//
// 매일 02:00 KST에 Vercel Cron에 의해 호출되어 지난 24시간 대화 데이터를 전수 분석한다.
// BATCH_SECRET 또는 CRON_SECRET Bearer 토큰 인증이 필수다.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDailyConversationQa } from "@/lib/dailyQa/runService";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // app/api/batch/v3/memory/worker/route.ts:9-18 의 배치 인증 패턴을 그대로 적용
    const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    const authHeader = req.headers.get("authorization") ?? "";
    if (
      configuredSecrets.length === 0 ||
      !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = createServiceClient();
    const nowIso = new Date().toISOString();

    // LLM Judge는 차후 독립 컴포넌트/모듈로 통합 예정이며, 크론 배치에서는 안정성과 비용 최적화를 위해
    // 1차 규칙 기반 탐지만 수행한다(judge: undefined).
    const result = await runDailyConversationQa({
      db,
      nowIso,
      triggerSource: "cron",
      judge: undefined,
    });

    // 아이 대화 원문은 보안/프라이버시상 응답에 포함하지 않고 메타데이터만 반환한다(§3-13).
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
