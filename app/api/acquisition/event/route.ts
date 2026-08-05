import { NextRequest, NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { createServiceClient, createClient } from "@/lib/supabase/server";

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

  let body: { event_type: string; visitor_id: string; attribution_id: string; link_id: string; parent_user_id?: string; };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event_type, visitor_id, attribution_id, link_id } = body;
  if (!event_type || !visitor_id || !attribution_id || !link_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // parent_user_id는 클라이언트가 보낸 값을 신뢰하지 않는다(스푸핑 방지) — 서버가
  // 검증한 로그인 세션에서만 가져온다. 로그인 전 이벤트(SIGNUP_PAGE_VIEW 등)는 null.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const parentUserId = user?.id || null;

  const svc = createServiceClient();
  
  const { error } = await svc.from("acquisition_events").insert({
    event_type,
    attribution_id,
    visitor_id,
    link_id,
    parent_user_id: parentUserId
  });

  if (error) {
    if (error.code !== "23505") { // ignore unique_violation for PARENT_SIGNUP_COMPLETED
       console.error("[acquisition/event] insert error:", error);
       return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
