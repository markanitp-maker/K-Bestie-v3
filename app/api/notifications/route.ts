import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveNotificationScope } from "@/lib/notifications/scope";
import { createInboxNotification, serializeNotification } from "@/lib/notifications/inbox";
import { APP_EVENTS_ANNOUNCEMENT_KEY, APP_EVENTS_ANNOUNCEMENT_VERSION } from "@/lib/events/announcementConfig";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveNotificationScope(user.id);
  if (!scope) return NextResponse.json({ error: "Notification scope unavailable" }, { status: 403 });

  const unreadOnly = req.nextUrl.searchParams.get("filter") === "unread";
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const now = new Date().toISOString();
  const db = createServiceClient();
  await createInboxNotification(db, {
    userId: user.id,
    childId: scope.role === "child" ? scope.childId : null,
    role: scope.role,
    type: "event",
    title: scope.role === "child" ? "케이 이벤트가 열렸어요!" : "내친구 케이 이벤트 안내",
    body: scope.role === "child" ? "3가지 이벤트에 참여하고 상품에도 도전해 보세요." : "아이가 참여할 수 있는 3가지 이벤트를 확인해 보세요.",
    targetUrl: scope.role === "child" ? "/child/home?event=announcement" : "/parent/home?event=announcement",
    sourceId: `${APP_EVENTS_ANNOUNCEMENT_KEY}:v${APP_EVENTS_ANNOUNCEMENT_VERSION}`,
    idempotencyKey: `event:${user.id}:${scope.role}:${APP_EVENTS_ANNOUNCEMENT_KEY}:v${APP_EVENTS_ANNOUNCEMENT_VERSION}`,
  });
  let query = supabase
    .from("notifications")
    .select("id,user_id,child_id,role,type,title,body,target_url,source_id,created_at,read_at,expires_at")
    .eq("user_id", user.id)
    .eq("role", scope.role)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (scope.role === "child") query = query.eq("child_id", scope.childId);
  if (unreadOnly) query = query.is("read_at", null);

  let countQuery = supabase.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("role", scope.role).is("read_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (scope.role === "child") countQuery = countQuery.eq("child_id", scope.childId);

  const settled = await Promise.allSettled([
    query,
    countQuery,
  ]);
  const listResult = settled[0].status === "fulfilled" ? settled[0].value : { data: null, error: settled[0].reason };
  const countResult = settled[1].status === "fulfilled" ? settled[1].value : { count: null, error: settled[1].reason };
  const { data: rows, error } = listResult;
  const { count, error: countError } = countResult;

  if (error || countError) return NextResponse.json({ error: "Notification lookup failed" }, { status: 500 });
  return NextResponse.json({
    notifications: (rows ?? []).map((row) => serializeNotification(row as Record<string, unknown>)),
    unreadCount: count ?? 0,
    role: scope.role,
  });
}
