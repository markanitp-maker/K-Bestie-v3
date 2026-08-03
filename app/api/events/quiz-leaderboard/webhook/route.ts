/**
 * POST /api/events/quiz-leaderboard/webhook — 퀴즈마스터 월별 리더보드 최종화 수신
 * (quiz.leaderboard.finalized.v1, requests/request_kbestie_app_events.md §11,
 *  .omc/specs/deep-interview-kbestie-app-events.md §0-4/§10)
 *
 * 기존 퀴즈마스터→K-Bestie 콜백(POST /api/rewards/golden-key/refund,
 * POST /api/quiz/completion)과 동일한 Bearer+Idempotency-Key 인증
 * (lib/quiz/rewardCallbackAuth.ts)을 그대로 재사용한다 — Idempotency-Key 헤더는
 * 반드시 payload의 eventId와 일치해야 통과한다.
 *
 * environment는 payload 값을 신뢰하지 않고 서버의 실제 Supabase target과 비교해
 * fail-closed로 거부한다(Dev 스냅샷의 Prod 유입, 또는 그 반대를 차단).
 *
 * checksum 필드는 저장·감사 목적으로만 보존한다 — 두 프로젝트 어느 쪽 문서에도
 * 정확한 계산 알고리즘이 명시되어 있지 않아, 검증 없이 재계산을 시도하면 잘못된
 * 알고리즘으로 정상 요청을 오탐 거부할 위험이 더 크다. 실제 보안 경계는
 * Bearer+Idempotency-Key(서버간 공유 시크릿)이다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRewardsCallbackAuth, sanitizeExternalText } from "@/lib/quiz/rewardCallbackAuth";
import { getAppEventEnvironment } from "@/lib/events/environment";

export const runtime = "nodejs";

const VALID_REWARD_AMOUNTS: Record<number, number> = { 1: 5000, 2: 3000, 3: 1000 };

interface Winner {
  rank?: number;
  childId?: string;
  score?: number;
  correctCount?: number;
  completedQuizCount?: number;
  rewardAmount?: number;
  isSeedUser?: boolean;
  rewardEligible?: boolean;
  tieBreakValues?: Record<string, unknown>;
}

interface WebhookBody {
  eventId?: string;
  environment?: string;
  period?: string;
  periodStartedAt?: string;
  periodEndedAtExclusive?: string;
  finalizedAt?: string;
  scoringVersion?: string;
  checksum?: string;
  winners?: Winner[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: WebhookBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = sanitizeExternalText(body.eventId);
  if (!eventId) {
    return NextResponse.json({ error: "missing_eventId" }, { status: 400 });
  }

  const authResult = verifyRewardsCallbackAuth(req, eventId);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const serverEnvironment = getAppEventEnvironment();
  if (body.environment !== serverEnvironment) {
    console.error("[quiz-leaderboard/webhook] environment mismatch", {
      received: body.environment,
      server: serverEnvironment,
    });
    return NextResponse.json({ error: "environment_mismatch" }, { status: 400 });
  }

  const periodKey = sanitizeExternalText(body.period);
  const scoringVersion = sanitizeExternalText(body.scoringVersion);
  const checksum = sanitizeExternalText(body.checksum);
  if (!periodKey || !scoringVersion || !checksum || !body.periodStartedAt || !body.periodEndedAtExclusive || !body.finalizedAt) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const winners = Array.isArray(body.winners) ? body.winners : [];
  if (winners.length === 0 || winners.length > 3) {
    return NextResponse.json({ error: "invalid_winners_count" }, { status: 400 });
  }

  const ranks = new Set<number>();
  for (const w of winners) {
    if (typeof w.rank !== "number" || ![1, 2, 3].includes(w.rank)) {
      return NextResponse.json({ error: "invalid_rank" }, { status: 400 });
    }
    if (ranks.has(w.rank)) {
      return NextResponse.json({ error: "duplicate_rank" }, { status: 400 });
    }
    ranks.add(w.rank);
    if (typeof w.childId !== "string" || !w.childId) {
      return NextResponse.json({ error: "missing_childId" }, { status: 400 });
    }
    if (w.rewardAmount !== VALID_REWARD_AMOUNTS[w.rank]) {
      console.error("[quiz-leaderboard/webhook] rewardAmount mismatch for rank", w.rank, w.rewardAmount);
      return NextResponse.json({ error: "invalid_reward_amount" }, { status: 400 });
    }
  }

  const service = createServiceClient();

  // eventId 멱등성 — 이미 처리된 요청이면 재처리 없이 성공으로 응답(재전송 안전).
  const { data: existingSnapshot } = await service
    .from("kbestie_quiz_final_snapshots")
    .select("id")
    .eq("environment", serverEnvironment)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existingSnapshot) {
    return NextResponse.json({ success: true, idempotent: true, snapshotId: existingSnapshot.id });
  }

  const { data: snapshot, error: snapshotErr } = await service
    .from("kbestie_quiz_final_snapshots")
    .insert({
      environment: serverEnvironment,
      period_key: periodKey,
      event_id: eventId,
      period_started_at: body.periodStartedAt,
      period_ended_at_exclusive: body.periodEndedAtExclusive,
      finalized_at: body.finalizedAt,
      scoring_version: scoringVersion,
      checksum,
    })
    .select("id")
    .single();

  if (snapshotErr || !snapshot) {
    // period_key unique 위반 = 이미 다른 eventId로 이 달이 확정된 상태(정정 재전송).
    // K-Bestie 쪽엔 정정 프로토콜이 없으므로 조용히 덮어쓰지 않고 명시적으로 거부한다.
    console.error("[quiz-leaderboard/webhook] snapshot insert failed:", snapshotErr?.message);
    return NextResponse.json({ error: "snapshot_conflict_or_error", detail: snapshotErr?.message }, { status: 409 });
  }

  const entryRows = winners.map((w) => ({
    snapshot_id: snapshot.id,
    rank: w.rank,
    child_id: w.childId,
    score: w.score ?? 0,
    correct_count: w.correctCount ?? null,
    completed_quiz_count: w.completedQuizCount ?? null,
    is_seed_user: w.isSeedUser === true,
    reward_eligible: w.rewardEligible !== false,
    reward_amount: w.rewardAmount ?? 0,
    tie_break_values: w.tieBreakValues ?? {},
  }));

  const { error: entriesErr } = await service.from("kbestie_quiz_final_entries").insert(entryRows);
  if (entriesErr) {
    console.error("[quiz-leaderboard/webhook] entries insert failed:", entriesErr.message);
    return NextResponse.json({ error: "entries_insert_failed" }, { status: 500 });
  }

  // 실제 아이(더미 제외 + rewardEligible)만 지급 대상 생성.
  const rewardTargets = entryRows.filter((e) => e.reward_eligible && !e.is_seed_user && e.reward_amount > 0);
  for (const target of rewardTargets) {
    const { data: entryRow } = await service
      .from("kbestie_quiz_final_entries")
      .select("id")
      .eq("snapshot_id", snapshot.id)
      .eq("child_id", target.child_id)
      .single();
    if (!entryRow) continue;

    const { error: rewardErr } = await service.from("event_reward_fulfillments").insert({
      environment: serverEnvironment,
      event_type: "quiz_leaderboard",
      event_reference_id: entryRow.id,
      child_id: target.child_id,
      reward_amount: target.reward_amount,
    });
    if (rewardErr) {
      console.error("[quiz-leaderboard/webhook] reward fulfillment insert failed:", rewardErr.message, { childId: target.child_id });
    }
  }

  return NextResponse.json({ success: true, snapshotId: snapshot.id, periodKey, rewardTargetsCreated: rewardTargets.length });
}
