import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: member } = await supabase
        .from('family_members')
        .select('family_id, role, id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (member?.family_id) {
        if (member.role === 'child') {
          const { data: childProfile } = await supabase
            .from('child_profiles')
            .select('id')
            .eq('member_id', member.id)
            .maybeSingle();
            
          await logBehaviorEvent({
            eventName: "child_login",
            actorType: "child",
            actorId: user.id,
            familyId: member.family_id,
            childId: childProfile?.id || null,
            feature: "auth",
            route: "/login",
          });
        } else {
          await logBehaviorEvent({
            eventName: "parent_login",
            actorType: "parent",
            actorId: user.id,
            familyId: member.family_id,
            feature: "auth",
            route: "/login",
          });
        }
      }
    }
  } catch (error) {
    console.error("[analytics/login] log failed:", error);
  }
  
  return NextResponse.json({ ok: true });
}
