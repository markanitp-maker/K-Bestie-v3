import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getSupabaseTarget } from "@/lib/supabase/env";

export const runtime = "nodejs";

const MAX_CONTENT_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateRequestNumber() {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${dateStr}-${randomStr}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const contactEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const content = typeof input.content === "string" ? input.content.trim() : "";
    if (!EMAIL_PATTERN.test(contactEmail) || contactEmail.length > 254) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    if (!content || content.length > MAX_CONTENT_LENGTH || /<\s*\/?\s*(script|style|iframe|object|embed)\b/i.test(content)) return NextResponse.json({ error: "Invalid content" }, { status: 400 });

    const serviceClient = createServiceClient();
    const tenSecondsAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await serviceClient
      .from("support_requests")
      .select("*", { count: "exact", head: true })
      .eq("contact_email", contactEmail)
      .gte("created_at", tenSecondsAgo);

    if (count && count > 0) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const requestNumber = generateRequestNumber();
    const { error } = await serviceClient.from("support_requests").insert({
      user_id: null, guardian_id: null, child_id: null, category: "inquiry", subject: "랜딩페이지 문의", body: content,
      contact_email: contactEmail, source: "landing", submitter_role: null, app_surface: "landing", current_route: "/",
      environment: getSupabaseTarget(), request_number: requestNumber, status: "open",
    });
    if (error) {
      console.error("[api/support/landing] insert error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, request_number: requestNumber });
  } catch (error) {
    console.error("[api/support/landing] unhandled error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
