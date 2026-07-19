import { SupabaseClient } from "@supabase/supabase-js";

export async function requireChildAccess(
  supabase: SupabaseClient,
  userId: string,
  childId: string
): Promise<{ allowed: boolean; role: "parent" | "child" | null }> {
  if (!userId || !childId) {
    return { allowed: false, role: null };
  }

  try {
    // 1. 사용자의 모든 가족 멤버십 조회
    const { data: members, error: memberErr } = await supabase
      .from("family_members")
      .select("id, family_id, role")
      .eq("user_id", userId);

    if (memberErr || !members || members.length === 0) {
      return { allowed: false, role: null };
    }

    // 2. 대상 자녀 프로필 조회
    const { data: child, error: childErr } = await supabase
      .from("child_profiles")
      .select("id, family_id, member_id")
      .eq("id", childId)
      .maybeSingle();

    if (childErr || !child) {
      return { allowed: false, role: null };
    }

    // 3. 관계 및 권한 매칭 검사
    for (const member of members) {
      if (member.family_id === child.family_id) {
        // 부모(owner_parent, parent)는 같은 가족(family_id)에 속한 모든 자녀에 접근 가능
        if (member.role === "owner_parent" || member.role === "parent") {
          return { allowed: true, role: "parent" };
        }
        // 자녀(child)는 본인의 member_id와 일치하는 child_profile만 접근 가능
        if (member.role === "child" && child.member_id === member.id) {
          return { allowed: true, role: "child" };
        }
      }
    }

    return { allowed: false, role: null };
  } catch (err) {
    console.error("[requireChildAccess] Authorization check failed:", err);
    return { allowed: false, role: null };
  }
}
