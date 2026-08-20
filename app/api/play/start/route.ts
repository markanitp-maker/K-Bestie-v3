import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { child_id?: string; play_type?: string; reservation_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { child_id, play_type, reservation_id } = body;
  if (!child_id || !play_type || !reservation_id) {
    return NextResponse.json({ error: "child_id, play_type, and reservation_id required" }, { status: 400 });
  }

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const approvalBlocked = await checkApprovalForChild(child_id);
  if (approvalBlocked) return approvalBlocked;

  // 1. 예약 성공시 start_new_play_session 호출
  const { data: startData, error: startErr } = await service.rpc("start_new_play_session", {
    p_child_id: child_id,
    p_play_type: play_type,
    p_new_reservation_id: reservation_id,
  });

  // 롤백이 실패했는데 "복구됐다" 고 답하면 아이 황금열쇠가 조용히 사라진다
  // (리뷰 지적, 2026-08-20). 재화는 되돌릴 수 없으니 복구 결과를 확인하고,
  // 실패했으면 그렇다고 말한다 — 그래야 사람이 찾아 고칠 수 있다.
  const restoreReservation = async (): Promise<boolean> => {
    const { error } = await service.rpc("restore_gold_key_reservation", {
      p_reservation_id: reservation_id,
    });
    if (error) {
      console.error(
        `[play/start] 황금열쇠 예약 복구 실패 (reservation ${reservation_id}, child ${child_id}):`,
        error.message
      );
      return false;
    }
    return true;
  };

  if (startErr || !startData || startData.length === 0) {
    console.error("[play/start] Start RPC error:", startErr);
    // 실패시 롤백
    const restored = await restoreReservation();
    return NextResponse.json(
      {
        error: restored
          ? "Start session failed, reservation restored"
          : "Start session failed and reservation restore failed",
        reservationRestored: restored,
      },
      { status: 500 }
    );
  }

  const startResult = startData[0] as { session_id: string | null; reason: string };

  if (!startResult.session_id) {
    // 실패시 롤백
    const restored = await restoreReservation();
    return NextResponse.json(
      {
        error: startResult.reason || "start_failed",
        reservationRestored: restored,
      },
      { status: restored ? 400 : 500 }
    );
  }

  const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", child_id).single();
  const validPlayTypes = ["comic_book", "quiz", "hairstyle", "mbti"];
  await logBehaviorEvent({
    eventName: "play_start",
    actorType: "child",
    childId: child_id,
    familyId: childData?.family_id,
    sessionId: startResult.session_id,
    feature: "play",
    playType: validPlayTypes.includes(play_type) ? (play_type as any) : null,
    route: "/api/play/start",
  }).catch(() => {});

  return NextResponse.json({
    session_id: startResult.session_id,
    reason: "ok",
  });
}
