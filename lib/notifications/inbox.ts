import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationRole = "parent" | "child";
export type NotificationType = "event" | "mission" | "report" | "reward" | "system";

export type InboxNotification = {
  id: string;
  userId: string;
  childId: string | null;
  role: NotificationRole;
  type: NotificationType;
  title: string;
  body: string;
  targetUrl: string;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
  expiresAt: string | null;
};

export type CreateNotificationInput = {
  userId: string;
  childId?: string | null;
  role: NotificationRole;
  type: NotificationType;
  title: string;
  body: string;
  targetUrl: string;
  sourceId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
};

function internalTarget(value: string) {
  return /^\/(?!\/)/.test(value) ? value : "/";
}

export async function createInboxNotification(db: SupabaseClient, input: CreateNotificationInput) {
  const row = {
    user_id: input.userId,
    child_id: input.childId ?? null,
    role: input.role,
    type: input.type,
    title: input.title.slice(0, 120),
    body: input.body,
    target_url: internalTarget(input.targetUrl),
    source_id: input.sourceId ?? null,
    idempotency_key: input.idempotencyKey,
    metadata: input.metadata ?? {},
    expires_at: input.expiresAt ?? null,
  };
  const { data, error } = await db
    .from("notifications")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id,user_id,child_id,role,type,title,body,target_url,source_id,created_at,read_at,expires_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: existing, error: lookupError } = await db
    .from("notifications")
    .select("id,user_id,child_id,role,type,title,body,target_url,source_id,created_at,read_at,expires_at")
    .eq("idempotency_key", input.idempotencyKey)
    .single();
  if (lookupError) throw lookupError;
  return existing;
}

export async function childAuthUserId(db: SupabaseClient, childId: string) {
  const { data: child, error: childError } = await db
    .from("child_profiles")
    .select("member_id")
    .eq("id", childId)
    .maybeSingle();
  if (childError) throw childError;
  if (!child?.member_id) return null;
  const { data: member, error: memberError } = await db
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .eq("role", "child")
    .is("deleted_at", null)
    .maybeSingle();
  if (memberError) throw memberError;
  return member?.user_id ?? null;
}

export function serializeNotification(row: Record<string, unknown>): InboxNotification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    childId: row.child_id ? String(row.child_id) : null,
    role: row.role as NotificationRole,
    type: row.type as NotificationType,
    title: String(row.title),
    body: String(row.body ?? ""),
    targetUrl: internalTarget(String(row.target_url ?? "/")),
    sourceId: row.source_id ? String(row.source_id) : null,
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

