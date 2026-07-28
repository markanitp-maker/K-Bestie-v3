import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/account/approval-status
 * 로그인한 보호자의 베타 승인 상태 조회. anon 클라이언트로 조회하며
 * parents_select_own RLS(auth.uid() = id 자기 자신 조회)에 의존한다
 * (app/api/account/status/route.ts와 동일한 패턴).
 * Response: { approval_status, rejected_reason, has_applied }
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: parent, error } = await supabase
      .from("parents")
      .select("approval_status, rejected_reason")
      .eq("id", user.id)
      .single();

    if (error || !parent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: application } = await supabase
      .from("beta_applications")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({ ...parent, has_applied: !!application });
  } catch (err: any) {
    console.error("[api/account/approval-status] exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
