import { createServiceClient } from "@/lib/supabase/server";

export type NotificationScope =
  | { role: "parent"; childId: null; scopeKey: "parent" }
  | { role: "child"; childId: string; scopeKey: string };

export async function resolveNotificationScope(userId: string): Promise<NotificationScope | null> {
  const service = createServiceClient();
  const { data: members, error } = await service
    .from("family_members")
    .select("id, role")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;

  const childMember = members?.find((member) => member.role === "child");
  if (childMember) {
    const { data: child, error: childError } = await service
      .from("child_profiles")
      .select("id")
      .eq("member_id", childMember.id)
      .maybeSingle();
    if (childError) throw childError;
    return child ? { role: "child", childId: child.id, scopeKey: child.id } : null;
  }

  if (members?.some((member) => member.role === "parent" || member.role === "owner_parent")) {
    return { role: "parent", childId: null, scopeKey: "parent" };
  }
  return null;
}
