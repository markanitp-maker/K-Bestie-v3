/**
 * POST /api/play/execution-ticket — 독립 놀이(MBTI 등) 실행 티켓 발급 (사용자용 API)
 *
 * 딥 인터뷰 확정(.omc/specs/deep-interview-mbti-platform-connection.md ③⑤): 로그인·
 * 아이 권한 확인 후 황금열쇠를 "예약"(reserve, 아직 확정 차감 아님)하고, 1회용 실행
 * 티켓을 발급해 Secure+HttpOnly 쿠키(Path=/play/{playId})로만 내려준다. 티켓 값 자체는
 * 응답 본문에 포함하지 않는다(URL·클라이언트 JS 노출 금지).
 *
 * 황금열쇠 확정 차감(confirm)은 독립 놀이 서버가 티켓을 서버간 교환하고 실행 준비
 * 완료를 알린 시점에만 일어난다(app/api/internal/play/ready/route.ts) — 여기서는
 * 예약만 한다.
 *
 * mode="resume": 이미 진행 중인(in_progress) 세션을 재개할 때 쓴다. 그 세션은 이미
 * 예전에 confirm된 황금열쇠로 시작된 것이라 새로 예약·차감하지 않는다(reservation_id
 * 없이 티켓만 발급 — mark_play_execution_ticket_ready가 이 경우 confirm을 건너뛴다).
 */

import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

const TICKET_TTL_SECONDS = 90;

interface StartTicketRequestBody {
  childId?: string;
  playId?: string;
  mode?: "start" | "resume" | "restart";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: StartTicketRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const childId = typeof body.childId === "string" ? body.childId : "";
  const playId = typeof body.playId === "string" ? body.playId : "";
  const mode = body.mode === "resume" ? "resume" : (body.mode === "restart" ? "restart" : "start");
  if (!childId || !playId) {
    return NextResponse.json({ error: "childId and playId required" }, { status: 400 });
  }

  const service = createServiceClient();

  const authCheck = await requireChildAccess(service, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: registryRow } = await service
    .from("play_registry")
    .select("play_id, keys_cost, is_active")
    .eq("play_id", playId)
    .maybeSingle();

  if (!registryRow || !registryRow.is_active) {
    return NextResponse.json({ error: "play_not_available" }, { status: 404 });
  }

  let reservationId: string | null = null;

  if (mode === "start" || mode === "restart") {
    const { data: reserveData, error: reserveErr } = await service.rpc("reserve_gold_keys_for_play", {
      p_child_id: childId,
      p_play_type: playId,
      p_keys_needed: registryRow.keys_cost,
      p_is_restart: mode === "restart",
    });

    if (reserveErr || !reserveData || reserveData.length === 0) {
      console.error("[execution-ticket] reserve RPC error:", reserveErr);
      return NextResponse.json({ error: "reserve_failed" }, { status: 500 });
    }

    const reserveResult = reserveData[0] as { reservation_id: string | null; reason: string };
    if (reserveResult.reason === "already_in_progress") {
      return NextResponse.json({ error: "already_in_progress" }, { status: 409 });
    }
    if (reserveResult.reason === "insufficient_balance") {
      return NextResponse.json({ error: "insufficient_balance" }, { status: 402 });
    }
    if (!reserveResult.reservation_id) {
      return NextResponse.json({ error: reserveResult.reason || "unknown_error" }, { status: 400 });
    }
    reservationId = reserveResult.reservation_id;
  } else {
    // resume: 새로 예약하지 않는다 — 이미 in_progress 세션이 있어야만 재개를 허용한다.
    // resume_expires_at이 지난 세션은 reserve_gold_keys_for_play가 이미 만료 처리하므로
    // 정상 흐름에서는 여기 남아있지 않지만, 방어적으로 동일 기준(/api/play/session의
    // canResume 계산과 일치)을 한 번 더 확인해 만료된 세션을 "이어하기"로 오인하지 않는다.
    const { data: existingSession } = await service
      .from("k_play_sessions")
      .select("id, resume_expires_at")
      .eq("child_id", childId)
      .eq("play_type", playId)
      .eq("status", "in_progress")
      .maybeSingle();

    const isResumeExpired =
      !!existingSession?.resume_expires_at && new Date(existingSession.resume_expires_at) <= new Date();

    if (!existingSession || isResumeExpired) {
      return NextResponse.json({ error: "no_session_to_resume" }, { status: 404 });
    }
  }

  const ticketToken = crypto.randomBytes(32).toString("base64url");

  const { data: issueData, error: issueErr } = await service.rpc("issue_play_execution_ticket", {
    p_ticket_token: ticketToken,
    p_play_id: playId,
    p_child_id: childId,
    p_reservation_id: reservationId,
    p_ttl_seconds: TICKET_TTL_SECONDS,
  });

  if (issueErr || !issueData || issueData.length === 0) {
    console.error("[execution-ticket] issue RPC error:", issueErr, { reservationId, mode });
    if (reservationId) {
      // start 경로에서만 방금 만든 예약을 보상 복원한다(resume은 애초에 예약이 없음).
      await service.rpc("restore_gold_key_reservation", { p_reservation_id: reservationId });
    }
    return NextResponse.json({ error: "issue_failed" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: `play_ticket_${playId}`,
    value: ticketToken,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/play/${playId}`,
    maxAge: TICKET_TTL_SECONDS,
  });

  return response;
}
