import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

const ALLOWED_EVENTS = new Set([
  "landing_start_clicked",
  "header_login_clicked",
  "header_signup_clicked",
  "social_auth_provider_selected",
  "social_auth_completed",
  "existing_user_routed_to_login",
  "new_user_routed_to_signup",
  "incomplete_user_resumed_signup",
  "social_auth_failed",
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!ALLOWED_EVENTS.has(body?.eventName)) {
      return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
    }

    const provider = body?.properties?.provider;
    if (provider !== undefined && provider !== "google" && provider !== "kakao") {
      return NextResponse.json({ error: "INVALID_PROVIDER" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    await logBehaviorEvent({
      eventName: body.eventName,
      actorType: user ? "parent" : "system",
      actorId: user?.id ?? null,
      feature: "auth",
      route: request.headers.get("referer")
        ? new URL(request.headers.get("referer")!).pathname
        : null,
      properties: provider ? { provider } : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
