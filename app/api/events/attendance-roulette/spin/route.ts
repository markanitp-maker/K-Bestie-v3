import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.childId || !body.idempotencyKey || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 200) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const access = await requireChildAccess(auth, user.id, body.childId);
  if (!access.allowed || access.role !== "child") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("spin_attendance_roulette", {
    p_child_id: body.childId,
    p_idempotency_key: body.idempotencyKey,
    p_test_result: null,
  });

  if (error) {
    console.error("[attendance-roulette/spin] RPC failed", error.code);
    return NextResponse.json({ error: "spin_failed" }, { status: 500 });
  }
  if (!data?.ok) {
    const status = data?.error === "no_available_spin" ? 409 : 400;
    return NextResponse.json(data, { status });
  }
  return NextResponse.json(data);
}
