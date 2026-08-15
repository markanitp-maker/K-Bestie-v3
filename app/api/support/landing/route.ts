import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getSupabaseTarget } from "@/lib/supabase/env";
import { notifyDiscordOfNewSupportRequest } from "@/lib/support/discord";

export const runtime = "nodejs";

const MAX_CONTENT_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recentSubmissionByIp = new Map<string, number>();

function generateRequestNumber() {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${dateStr}-${randomStr}`;
}

function getClientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const previous = recentSubmissionByIp.get(ip);
  if (previous && now - previous < RATE_LIMIT_WINDOW_MS) return true;
  recentSubmissionByIp.set(ip, now);
  if (recentSubmissionByIp.size > 1000) for (const [key, submittedAt] of recentSubmissionByIp) if (now - submittedAt >= RATE_LIMIT_WINDOW_MS) recentSubmissionByIp.delete(key);
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const contactEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const content = typeof input.content === "string" ? input.content.trim() : "";
    if (!EMAIL_PATTERN.test(contactEmail) || contactEmail.length > 254) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    if (!content || content.length > MAX_CONTENT_LENGTH || /<\s*\/?\s*(script|style|iframe|object|embed)\b/i.test(content)) return NextResponse.json({ error: "Invalid content" }, { status: 400 });
    if (isRateLimited(getClientIp(request))) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const requestNumber = generateRequestNumber();
    const { data: inserted, error } = await createServiceClient().from("support_requests").insert({
      user_id: null, guardian_id: null, child_id: null, category: "inquiry", subject: "랜딩페이지 문의", body: content,
      contact_email: contactEmail, source: "landing", submitter_role: null, app_surface: "landing", current_route: "/",
      environment: getSupabaseTarget(), request_number: requestNumber, status: "open",
    }).select("id,created_at").single();
    if (error) {
      console.error("[api/support/landing] insert error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (inserted?.id) {
      try {
        after(() => notifyDiscordOfNewSupportRequest({
            category: "inquiry",
            requestNumber,
            requestId: inserted.id,
            appSurface: "landing",
            createdAt: inserted.created_at ?? new Date().toISOString(),
            title: "랜딩페이지 문의",
            content,
          }, new URL(request.url).origin)
        );
      } catch (notifyError) {
        console.warn("[api/support/landing] discord notification failed to schedule", notifyError);
      }
    }

    return NextResponse.json({ ok: true, request_number: requestNumber });
  } catch (error) {
    console.error("[api/support/landing] unhandled error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

