import { NextRequest, NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const runtime = "nodejs";

const rateLimit = new Map<string, { count: number, resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimit.get(ip);
  if (record) {
    if (now > record.resetAt) {
      rateLimit.set(ip, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (record.count >= 60) return false;
    record.count++;
    return true;
  }
  rateLimit.set(ip, { count: 1, resetAt: now + 60000 });
  return true;
}

export async function POST(req: NextRequest) {
  const headersList = await nextHeaders();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || headersList.get("x-real-ip") || "unknown";
  
  if (ip !== "unknown" && !checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { link_id: string; visitor_id: string; landing_path?: string; referrer?: string; is_internal_test?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { link_id, visitor_id, landing_path, referrer, is_internal_test } = body;
  if (!link_id || !visitor_id) {
    return NextResponse.json({ error: "link_id and visitor_id are required" }, { status: 400 });
  }

  const userAgent = headersList.get("user-agent") || "";
  const ipHash = ip !== "unknown" ? crypto.createHash("sha256").update(ip).digest("hex") : null;
  
  let deviceCategory = "desktop";
  if (/mobile/i.test(userAgent)) deviceCategory = "mobile";
  if (/tablet/i.test(userAgent)) deviceCategory = "tablet";
  
  let uaCategory = "other";
  if (/kakao/i.test(userAgent)) uaCategory = "kakaotalk";
  else if (/instagram/i.test(userAgent)) uaCategory = "instagram";
  else if (/Chrome/i.test(userAgent)) uaCategory = "chrome";
  else if (/Safari/i.test(userAgent)) uaCategory = "safari";

  const svc = createServiceClient();

  const { data: link } = await svc.from("acquisition_links")
    .select("id, status")
    .eq("link_id", link_id)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: "Invalid link_id" }, { status: 400 });
  }

  const { error } = await svc.from("acquisition_visits").insert({
    link_id,
    visitor_id,
    landing_path: landing_path || null,
    referrer: referrer || null,
    user_agent_category: uaCategory,
    device_category: deviceCategory,
    is_internal_test: !!is_internal_test,
    ip_hash: ipHash
  });

  if (error) {
    console.error("[acquisition/click] insert error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  
  return NextResponse.json({ ok: true, status: link.status });
}
