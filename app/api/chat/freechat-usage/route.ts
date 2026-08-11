import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// 자유대화 10분 세션+1분 휴식 하드리밋 — 현재 베타 확정 정책(Goal 없음·Completion
// 없음·횟수/시간/턴 제한 없음)에 따라 기본 OFF. 이 함수 하나로 GET/POST 양쪽을
// 게이트해, 꺼져 있을 때는 freechat_usage_state RPC(DB 상태 전이)를 아예 건드리지
// 않고 "항상 활성" 응답만 합성해서 돌려준다 — 로직 자체는 삭제하지 않고 "true"로
// 켤 때만 그대로 동작한다.
function isFreeChatHardLimitEnabled(): boolean {
  return process.env.FREE_CHAT_HARD_LIMIT_ENABLED === "true";
}

interface UsageStateRow {
  status: "active" | "cooldown" | "ended";
  started_at: string | null;
  session_ends_at: string | null;
  cooldown_until: string | null;
}

function toResponsePayload(row: UsageStateRow) {
  const now = Date.now();
  const sessionEndsAt = row.session_ends_at ? new Date(row.session_ends_at).getTime() : null;
  const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until).getTime() : null;

  return {
    status: row.status,
    startedAt: row.started_at,
    sessionEndsAt: row.session_ends_at,
    cooldownUntil: row.cooldown_until,
    remainingSessionSeconds: row.status === "active" && sessionEndsAt
      ? Math.max(0, Math.ceil((sessionEndsAt - now) / 1000))
      : 0,
    remainingCooldownSeconds: row.status === "cooldown" && cooldownUntil
      ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
      : 0,
  };
}

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  if (!authCheck.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isFreeChatHardLimitEnabled()) {
    return NextResponse.json({
      status: "active",
      startedAt: null,
      sessionEndsAt: null,
      cooldownUntil: null,
      remainingSessionSeconds: 0,
      remainingCooldownSeconds: 0,
    });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("get_freechat_usage_state", { p_child_id: childId }).single();
  if (error || !data) {
    console.error("[freechat-usage] get state rpc error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json(toResponsePayload(data as UsageStateRow));
}

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; action?: "start" | "end"; startedAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, action } = body;
  if (!childId || (action !== "start" && action !== "end")) {
    return NextResponse.json({ error: "childId and valid action required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  if (!authCheck.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isFreeChatHardLimitEnabled()) {
    if (action === "start") {
      return NextResponse.json({
        allowed: true,
        status: "active",
        startedAt: null,
        sessionEndsAt: null,
        cooldownUntil: null,
        remainingSessionSeconds: 0,
        remainingCooldownSeconds: 0,
      });
    }
    return NextResponse.json({ status: "active", cooldownUntil: null, remainingCooldownSeconds: 0 });
  }

  const service = createServiceClient();

  if (action === "start") {
    const { data, error } = await service.rpc("start_freechat_session", { p_child_id: childId }).single();
    if (error || !data) {
      console.error("[freechat-usage] start rpc error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    const row = data as UsageStateRow & { allowed: boolean };
    return NextResponse.json({ allowed: row.allowed, ...toResponsePayload(row) });
  }

  // action === "end"
  if (!body.startedAt) {
    return NextResponse.json({ error: "startedAt required for end" }, { status: 400 });
  }
  const { data, error } = await service
    .rpc("end_freechat_session", { p_child_id: childId, p_started_at: body.startedAt })
    .single();
  if (error || !data) {
    console.error("[freechat-usage] end rpc error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  const row = data as { status: string; cooldown_until: string | null };
  return NextResponse.json({
    status: row.status,
    cooldownUntil: row.cooldown_until,
    remainingCooldownSeconds: row.status === "cooldown" && row.cooldown_until
      ? Math.max(0, Math.ceil((new Date(row.cooldown_until).getTime() - Date.now()) / 1000))
      : 0,
  });
}
