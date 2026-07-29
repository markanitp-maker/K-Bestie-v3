import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

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
