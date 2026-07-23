import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("report_views").insert({ report_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const { data: member } = await supabase.from('family_members').select('family_id').eq('user_id', user.id).maybeSingle();
    const { data: report } = await supabase.from('daily_reports').select('child_id').eq('id', id).maybeSingle();
    
    if (member?.family_id) {
      await logBehaviorEvent({
        eventName: "parent_report_view",
        actorType: "parent",
        actorId: user.id,
        familyId: member.family_id,
        childId: report?.child_id,
        feature: "daily_report",
        route: "/parent/report/[id]"
      });
    }
  } catch (e) {
    // 의도적 무시
  }

  return NextResponse.json({ ok: true });
}
