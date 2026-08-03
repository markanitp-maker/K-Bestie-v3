import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { syncQuizRewardFulfillments } from "@/lib/events/quizRewardSync";

export const runtime = "nodejs";

// 이벤트 시스템 일일 정산 — Vercel Cron(매일 00:05 KST, Hobby 플랜 제약으로 하루 1회) +
// 관리자 수동 재실행 양쪽에서 호출 가능한 멱등 엔드포인트.
// 1) 미션 30일 온보딩 이벤트 종료 확정(finalize_mission_onboarding_event RPC, 이미
//    completed인 이벤트는 그대로 반환하므로 재호출 안전 — 요청서 §10.2).
// 2) 퀴즈마스터가 확정한 quiz_leaderboard_final_snapshots/entries를 읽어
//    event_reward_fulfillments를 동기화(2026-08-04 결정 — 웹훅 대신 직접 DB 동기화).
function isAuthorized(req: NextRequest): boolean {
  const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  const authHeader = req.headers.get("authorization") ?? "";
  return configuredSecrets.length > 0 && configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`);
}

async function runFinalize() {
  const service = createServiceClient();
  const environment = getAppEventEnvironment();
  const nowIso = new Date().toISOString();

  const { data: dueEvents, error } = await service
    .from("child_mission_onboarding_events")
    .select("id")
    .eq("environment", environment)
    .neq("status", "completed")
    .lte("ends_at", nowIso)
    .limit(500);

  if (error) {
    throw new Error(`due-events query failed: ${error.message}`);
  }

  const results: { eventId: string; ok: boolean; error?: string }[] = [];
  for (const row of dueEvents ?? []) {
    const { error: rpcErr } = await service.rpc("finalize_mission_onboarding_event", { p_event_id: row.id });
    results.push({ eventId: row.id, ok: !rpcErr, error: rpcErr?.message });
    if (rpcErr) {
      console.error("[mission-onboarding/finalize] RPC failed", { eventId: row.id, error: rpcErr.message });
    }
  }

  const quizSync = await syncQuizRewardFulfillments(service);

  return { environment, scanned: dueEvents?.length ?? 0, results, quizSync };
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runFinalize();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[mission-onboarding/finalize] error:", (err as Error).message);
    return NextResponse.json({ error: "Finalize failed" }, { status: 500 });
  }
}

// Vercel Cron은 기본적으로 GET으로 호출하고, 설정된 CRON_SECRET을 Authorization 헤더로 보낸다.
export async function GET(req: NextRequest) {
  return POST(req);
}
