import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getSupabaseTarget } from "@/lib/supabase/env";

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

/** 자유대화 세션당 10분·자연 종료 후 1분 휴식은 운영 계정 정책이다. Dev/Preview
 *  배포이거나 해당 아이 계정이 is_test_account=true면 반복 QA를 위해 전부 우회한다
 *  (서버가 판단 — 클라이언트가 보낼 수 있는 값이 아니다).
 *  주의: VERCEL_ENV는 k-bestie-v3-dev/k-bestie-v3 두 프로젝트 모두 `vercel --prod`로
 *  배포하므로 항상 "production"이라 Dev/Prod 구분에 쓸 수 없다 — 대신 이 저장소가
 *  이미 쓰고 있는 NEXT_PUBLIC_SUPABASE_TARGET(dev/prod, 프로젝트별로 다르게 설정됨)로
 *  판단한다. */
async function resolveTestBypass(childId: string): Promise<boolean> {
  if (getSupabaseTarget() !== "prod") return true;
  const service = createServiceClient();
  const { data } = await service.from("child_profiles").select("is_test_account").eq("id", childId).maybeSingle();
  return data?.is_test_account === true;
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
  const isTestBypass = await resolveTestBypass(childId);
  const { data, error } = await service
    .rpc("get_freechat_usage_state", { p_child_id: childId, p_is_test_bypass: isTestBypass })
    .single();
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
  const isTestBypass = await resolveTestBypass(childId);

  if (action === "start") {
    const { data, error } = await service
      .rpc("start_freechat_session", { p_child_id: childId, p_is_test_bypass: isTestBypass })
      .single();
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
    .rpc("end_freechat_session", { p_child_id: childId, p_started_at: body.startedAt, p_is_test_bypass: isTestBypass })
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
