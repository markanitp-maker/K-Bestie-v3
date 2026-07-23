import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveTestChild } from "@/lib/child/testAccount";
import { normalizeConversationMode } from "@/lib/plan/conversationMode";

export const runtime = "nodejs";

// A~E 대화방식 테스트 세션 override API. Plan01 §3.4/§6.
// 조회(GET)·설정(POST)·해제(DELETE) 모두 서버가 is_test_account=true를 재검증한다.
// 일반 계정/부모/직접 URL 호출은 403. tier는 절대 바꾸지 않는다(순수 override 저장).

async function gate(): Promise<{ childId: string } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  const test = await resolveTestChild(svc, user.id);
  if (!test) return NextResponse.json({ error: "Forbidden: 테스트 계정이 아닙니다" }, { status: 403 });
  return test;
}

// GET → { selectedMode: 'A'~'E' | null }
export async function GET() {
  const g = await gate();
  if (g instanceof NextResponse) return g;
  const svc = createServiceClient();
  const { data } = await svc
    .from("test_mode_overrides")
    .select("conversation_mode")
    .eq("child_id", g.childId)
    .maybeSingle();
  return NextResponse.json({ isTestAccount: true, selectedMode: data?.conversation_mode ?? null, childId: g.childId });
}

// POST { mode: 'A'~'E' } → 테스트 세션 override 저장(upsert). tier 변경 없음.
export async function POST(req: NextRequest) {
  const g = await gate();
  if (g instanceof NextResponse) return g;

  let body: { mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const mode = normalizeConversationMode(body.mode);
  if (!mode) return NextResponse.json({ error: "mode는 A~E 중 하나여야 합니다" }, { status: 400 });

  const svc = createServiceClient();
  const { error } = await svc
    .from("test_mode_overrides")
    .upsert({ child_id: g.childId, conversation_mode: mode, updated_at: new Date().toISOString() }, { onConflict: "child_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, selectedMode: mode });
}

// DELETE → 테스트 종료: override 제거.
export async function DELETE() {
  const g = await gate();
  if (g instanceof NextResponse) return g;
  const svc = createServiceClient();
  const { error } = await svc.from("test_mode_overrides").delete().eq("child_id", g.childId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, selectedMode: null });
}
