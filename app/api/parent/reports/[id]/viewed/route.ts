import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: report, error: reportError } = await supabase
    .from("daily_reports")
    .select("child_id")
    .eq("id", id)
    .maybeSingle();
  if (reportError || !report?.child_id) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const access = await requireChildAccess(supabase, user.id, report.child_id);
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // daily_reports가 session_id 대신 child_id를 기준으로 생성되는 현재 구조에서는
  // 레거시 report_views RLS가 유효한 부모도 거부할 수 있다. 위에서 자녀 접근권한을
  // 명시적으로 검증한 뒤 service role로 열람 기록만 남긴다.
  const service = createServiceClient();
  const { error } = await service.from("report_views").insert({ report_id: id, viewer_id: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const { data: member } = await supabase.from('family_members').select('family_id').eq('user_id', user.id).maybeSingle();
    if (member?.family_id) {
      await logBehaviorEvent({
        eventName: "parent_report_view",
        actorType: "parent",
        actorId: user.id,
        familyId: member.family_id,
        childId: report.child_id,
        feature: "daily_report",
        route: "/parent/report/[id]"
      });
    }
  } catch (e) {
    // 의도적 무시
  }

  return NextResponse.json({ ok: true });
}
