import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveNotificationScope } from "@/lib/notifications/scope";

export const runtime = "nodejs";
const ONBOARDING_VERSION = 1;

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const scope = await resolveNotificationScope(user.id);
  return scope ? { user, scope, service: createServiceClient() } : null;
}

export async function GET(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const installationId = req.nextUrl.searchParams.get("installationId") || "";
  const [{ data: preference }, { data: subscription }] = await Promise.all([
    ctx.service.from("notification_preferences")
      .select("onboarding_version,onboarding_completed_at,last_prompted_at,parent_report_enabled,mission_start_enabled")
      .eq("user_id", ctx.user.id).eq("role", ctx.scope.role).eq("scope_key", ctx.scope.scopeKey).maybeSingle(),
    installationId
      ? ctx.service.from("push_subscriptions").select("id,permission_status,is_active")
          .eq("user_id", ctx.user.id).eq("installation_id", installationId).eq("is_active", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const createdAt = new Date(ctx.user.created_at).getTime();
  return NextResponse.json({
    role: ctx.scope.role,
    childId: ctx.scope.childId,
    onboardingVersion: ONBOARDING_VERSION,
    onboardingCompleted: Boolean(preference?.onboarding_completed_at && (preference.onboarding_version ?? 0) >= ONBOARDING_VERSION),
    lastPromptedAt: preference?.last_prompted_at ?? null,
    parentReportEnabled: preference?.parent_report_enabled ?? true,
    missionStartEnabled: preference?.mission_start_enabled ?? true,
    active: Boolean(subscription?.is_active && subscription.permission_status === "granted"),
    isExistingUser: Number.isFinite(createdAt) && Date.now() - createdAt > 24 * 60 * 60 * 1000,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.action === "defer" || body.action === "preference") {
    const values = {
      user_id: ctx.user.id, child_id: ctx.scope.childId, role: ctx.scope.role, scope_key: ctx.scope.scopeKey,
      onboarding_version: ONBOARDING_VERSION, last_prompted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...(body.action === "defer" ? { onboarding_completed_at: new Date().toISOString() } : {}),
      ...(body.action === "preference" && ctx.scope.role === "parent" && typeof body.enabled === "boolean"
        ? { parent_report_enabled: body.enabled } : {}),
      ...(body.action === "preference" && ctx.scope.role === "child" && typeof body.enabled === "boolean"
        ? { mission_start_enabled: body.enabled } : {}),
    };
    const { error } = await ctx.service.from("notification_preferences").upsert(values, { onConflict: "user_id,role,scope_key" });
    if (error) return NextResponse.json({ error: "Preference update failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = body.keys as { p256dh?: string; auth?: string } | undefined;
  const installationId = typeof body.installationId === "string" ? body.installationId : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : installationId;
  if (!endpoint.startsWith("https://") || !keys?.p256dh || !keys.auth || !installationId || installationId.length > 100) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const { error } = await ctx.service.rpc("register_push_subscription_v1", {
    p_user_id: ctx.user.id, p_child_id: ctx.scope.childId, p_role: ctx.scope.role,
    p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_device_id: deviceId, p_installation_id: installationId,
    p_platform: typeof body.platform === "string" ? body.platform.slice(0, 50) : null,
    p_browser: typeof body.browser === "string" ? body.browser.slice(0, 50) : null,
    p_user_agent: req.headers.get("user-agent") || "", p_onboarding_version: ONBOARDING_VERSION,
  });
  if (error) return NextResponse.json({ error: "Subscription registration failed" }, { status: 500 });
  return NextResponse.json({ ok: true, role: ctx.scope.role, childId: ctx.scope.childId });
}

export async function DELETE(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { endpoint?: string; installationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.endpoint && !body.installationId) return NextResponse.json({ error: "Subscription identity required" }, { status: 400 });
  let query = ctx.service.from("push_subscriptions").update({ is_active: false, permission_status: "denied", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", ctx.user.id);
  query = body.endpoint ? query.eq("endpoint", body.endpoint) : query.eq("installation_id", body.installationId!);
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Subscription removal failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
