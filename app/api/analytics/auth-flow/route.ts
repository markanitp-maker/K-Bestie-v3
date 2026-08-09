import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function isAllowed(ip: string): boolean {
  const now = Date.now();
  const current = rateLimit.get(ip);
  if (!current || current.resetAt <= now) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

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
  "kakao_link_open",
  "kakao_inapp_detected",
  "external_browser_cta_view",
  "external_browser_cta_click",
  "external_browser_arrived",
  "pwa_install_offer_view",
  "pwa_install_click",
  "pwa_install_dismiss",
  "pwa_installed",
  "pwa_first_launch",
  "notification_onboarding_view",
  "notification_permission_granted",
  "notification_permission_denied",
]);

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    if (!isAllowed(ip)) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

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
