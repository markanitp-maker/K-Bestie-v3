import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
// claude-review 지적(단순-4): 이 route는 원래 인증 액션에서만 호출됐지만, 랜딩
// 페이지가 익명 방문마다 landing_view를 호출하면서 고유 IP 수가 급증할 수 있다.
// Fluid Compute가 인스턴스를 재사용하므로, 만료된 항목을 지우지 않으면 이 Map이
// warm 인스턴스 수명 동안 무한히 커진다. 매 호출마다 전체 스캔하는 대신, 호출
// 횟수 기준으로 주기적으로만 만료 항목을 정리한다.
let rateLimitCallsSinceSweep = 0;
const RATE_LIMIT_SWEEP_INTERVAL = 200;

function isAllowed(ip: string): boolean {
  const now = Date.now();
  rateLimitCallsSinceSweep += 1;
  if (rateLimitCallsSinceSweep >= RATE_LIMIT_SWEEP_INTERVAL) {
    rateLimitCallsSinceSweep = 0;
    for (const [key, entry] of rateLimit) {
      if (entry.resetAt <= now) rateLimit.delete(key);
    }
  }
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
  "landing_view",
  "hero_beta_cta_click",
  "hero_report_cta_click",
  "daily_report_view",
  "daily_beta_cta_click",
  "weekly_report_view",
  "trust_section_view",
  "beta_cta_click",
  "faq_open",
  "final_beta_cta_click",
  "signup_start",
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

const ATTRIBUTION_FIELDS = {
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
  item: "item",
} as const;

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

    const properties: Record<string, string> = {};
    if (provider) properties.provider = provider;
    for (const [clientKey, storageKey] of Object.entries(ATTRIBUTION_FIELDS)) {
      const value = body?.properties?.[clientKey];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > 120) {
        return NextResponse.json({ error: "INVALID_ATTRIBUTION" }, { status: 400 });
      }
      properties[storageKey] = value;
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
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
