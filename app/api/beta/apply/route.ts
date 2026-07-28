import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/beta/apply
 * 베타 신청 설문 저장. answers는 자유 형식 jsonb(phone/age_group/referral_source/motivation)
 * - 이미 신청한 사용자는 중복 저장하지 않고 "이미 신청됨" 응답을 반환한다
 *   (beta_applications.user_id에는 DB 유니크 제약이 없어 여기서 먼저 확인한다).
 * Response: { success: true } / { success: true, alreadyApplied: true }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { phone, age_group, referral_source, motivation } = body ?? {};

    const answers: Record<string, string> = {};
    if (typeof phone === "string" && phone.trim()) answers.phone = phone.trim();
    if (typeof age_group === "string" && age_group.trim()) answers.age_group = age_group.trim();
    if (typeof referral_source === "string" && referral_source.trim()) answers.referral_source = referral_source.trim();
    if (typeof motivation === "string" && motivation.trim()) answers.motivation = motivation.trim();

    const { data: existing, error: existingError } = await supabase
      .from("beta_applications")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingError) {
      console.error("[api/beta/apply] existing check error:", existingError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ success: true, alreadyApplied: true });
    }

    const { error: insertError } = await supabase
      .from("beta_applications")
      .insert({ user_id: user.id, answers });

    if (insertError) {
      console.error("[api/beta/apply] insert error:", insertError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[api/beta/apply] exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
