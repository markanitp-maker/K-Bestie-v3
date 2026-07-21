import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const GROUPS = ["A", "B", "C"] as const;
const PROVIDERS = ["vertex"] as const;

// GET /api/admin/provider-switch — 그룹A/B/C 현재 provider/model 조회.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const service = createServiceClient();
  const { data, error } = await service
    .from("provider_switch_settings")
    .select('"group", provider, model_id, updated_at, updated_by')
    .order('"group"', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ settings: data ?? [] });
}

// POST /api/admin/provider-switch { group, provider, modelId } — 그룹별 스위치 변경.
// server-trust: 클라이언트는 값만 전달, 화이트리스트 인증은 requireAdmin()이 담당.
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { group?: string; provider?: string; modelId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { group, provider, modelId } = body;
  if (!group || !GROUPS.includes(group as (typeof GROUPS)[number])) {
    return NextResponse.json({ error: "group must be one of A/B/C" }, { status: 400 });
  }
  if (!provider || !PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return NextResponse.json({ error: "provider must be vertex" }, { status: 400 });
  }
  if (!modelId || typeof modelId !== "string") {
    return NextResponse.json({ error: "modelId required" }, { status: 400 });
  }

  // 프리플라이트: Vertex로 저장하려는데 Vertex 자격증명이 아예 없으면 저장 자체를 막는다
  // (스위치만 Vertex로 바뀌고 실제 호출은 실패하는 상태를 방지).
  if (provider === "vertex" && (!process.env.GCP_VERTEX_SA_KEY_JSON || !process.env.GOOGLE_CLOUD_PROJECT)) {
    return NextResponse.json(
      { error: "GCP_VERTEX_SA_KEY_JSON/GOOGLE_CLOUD_PROJECT가 설정되지 않아 Vertex로 전환할 수 없습니다" },
      { status: 400 }
    );
  }

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();

  const service = createServiceClient();
  const { error } = await service
    .from("provider_switch_settings")
    .update({ provider, model_id: modelId, updated_at: new Date().toISOString(), updated_by: user?.email ?? null })
    .eq('"group"', group);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
