import { SupabaseClient } from "@supabase/supabase-js";

export async function requireChildAccess(
  supabase: SupabaseClient,
  userId: string,
  childId: string
): Promise<{ allowed: boolean; role: "parent" | "child" | null; child?: any }> {
  if (!userId || !childId) {
    return { allowed: false, role: null };
  }

  try {
    const [membersRes, childRes] = await Promise.all([
      supabase.from("family_members").select("id, family_id, role, user_id").eq("user_id", userId),
      supabase.from("child_profiles").select("id, grade, family_id, member_id").eq("id", childId).maybeSingle()
    ]);

    const members = membersRes.data;
    const memberErr = membersRes.error;
    const child = childRes.data;
    const childErr = childRes.error;

    if (memberErr || !members || members.length === 0) {
      return { allowed: false, role: null };
    }

    if (childErr || !child) {
      return { allowed: false, role: null };
    }

    // 3. 관계 및 권한 매칭 검사
    for (const member of members) {
      if (member.family_id === child.family_id) {
        // 부모(owner_parent, parent)는 같은 가족(family_id)에 속한 모든 자녀에 접근 가능
        if (member.role === "owner_parent" || member.role === "parent") {
          return { allowed: true, role: "parent", child };
        }
        // 자녀(child)는 본인의 member_id와 일치하는 child_profile만 접근 가능
        if (member.role === "child" && child.member_id === member.id) {
          return { allowed: true, role: "child", child };
        }
      }
    }

    return { allowed: false, role: null };
  } catch (err) {
    console.error("[requireChildAccess] Authorization check failed:", err);
    return { allowed: false, role: null };
  }
}
