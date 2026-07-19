import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

const EVENT_LIMIT = 200;

// GET /api/admin/safety-events?childId=xxx — chat_sessions을 거쳐 아이의 safety_events를 조회.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const childId = req.nextUrl.searchParams.get("childId");
  const includeRawText = req.nextUrl.searchParams.get("includeRawText") === "true";

  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const client = await createClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized admin" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: sessions, error: sessionsError } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const sessionIds = (sessions ?? []).map((s) => s.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[] = [];

  if (sessionIds.length > 0) {
    const { data: fetchedEvents, error } = await service
      .from("safety_events_admin_view")
      .select("id, session_id, subcategory, created_at, viewed_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    events = fetchedEvents ?? [];

    const isAlphaMode = process.env.SAFETY_EVENTS_ALPHA_MODE === "true";

    if (includeRawText && events.length > 0) {
      if (isAlphaMode) {
        const results = await Promise.allSettled(
          events.map(async (e) => {
            const { data: text, error: rpcError } = await service.rpc("get_safety_event_child_text", {
              p_event_id: e.id,
              p_requesting_admin_id: user.id,
              p_env: "alpha"
            });
            if (!rpcError && text) {
              return { id: e.id, child_text: text };
            }
            return { id: e.id, child_text: null };
          })
        );

        const textMap = new Map<string, string | null>();
        results.forEach(res => {
          if (res.status === "fulfilled") {
            textMap.set(res.value.id, res.value.child_text);
          }
        });
        events = events.map(e => ({
          ...e,
          child_text: textMap.get(e.id) ?? null
        }));
      } else {
        events = events.map(e => ({
          ...e,
          child_text: null
        }));
      }
    }
  }

  // 감사 로그 기록 (성공 여부에 관계없이 조회 결과는 반환)
  try {
    const { error: insertError } = await service.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email || "",
      action: "view_safety_events",
      child_id: childId,
    });
    if (insertError) {
      console.error("[safety-events API] Failed to insert audit log:", insertError);
    }
  } catch (auditError) {
    console.error("[safety-events API] Audit log recording failed:", auditError);
  }

  return NextResponse.json({ events });
}

