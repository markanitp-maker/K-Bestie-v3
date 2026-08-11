import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { excludeDeleted } from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();

  let q = supabase.from("acquisition_links").select("*");
  q = excludeDeleted(q);
  q = q.order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) {
    console.error("[admin/acquisition/links] GET error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const links = data ?? [];

  // Get aggregates
  const linkIds = links.map(l => l.link_id);
  
  if (linkIds.length > 0) {
    // 1. Clicks (acquisition_visits)
    const { data: visits } = await supabase.from("acquisition_visits")
      .select("link_id, visitor_id")
      .in("link_id", linkIds)
      .eq("is_internal_test", false);
    
    // 2. Signups (acquisition_events PARENT_SIGNUP_COMPLETED)
    const { data: signups } = await supabase.from("acquisition_events")
      .select("link_id, visitor_id, occurred_at")
      .eq("event_type", "PARENT_SIGNUP_COMPLETED")
      .in("link_id", linkIds);
      
    const statsByLink = new Map();
    for (const id of linkIds) {
      statsByLink.set(id, { clicks: 0, uniqueVisitors: new Set(), signups: 0, lastSignup: null });
    }
    
    for (const v of visits || []) {
      const s = statsByLink.get(v.link_id);
      if (s) {
        s.clicks++;
        s.uniqueVisitors.add(v.visitor_id);
      }
    }
    
    for (const s of signups || []) {
      const st = statsByLink.get(s.link_id);
      if (st) {
        st.signups++;
        if (!st.lastSignup || new Date(s.occurred_at) > new Date(st.lastSignup)) {
          st.lastSignup = s.occurred_at;
        }
      }
    }
    
    for (const l of links) {
      const st = statsByLink.get(l.link_id);
      l.clicks = st.clicks;
      l.unique_visitors = st.uniqueVisitors.size;
      l.signups = st.signups;
      l.conversion_rate = st.uniqueVisitors.size > 0 ? (st.signups / st.uniqueVisitors.size) * 100 : 0;
      l.last_signup_at = st.lastSignup;
    }
  }

  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("admin_acquisition_links_create");
  if (denied) return denied;

  const supabase = createServiceClient();
  
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { channel_name, utm_source, utm_medium, utm_campaign, utm_content, purpose, destination_path, status, memo, starts_at, ends_at } = body;
  
  if (!channel_name || !utm_source || !utm_medium || !utm_campaign || !purpose) {
    return NextResponse.json({ error: "Required fields missing" }, { status: 400 });
  }

  const normalize = (str: string) => {
    return str
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  };

  const normSource = normalize(utm_source);
  const normCampaign = normalize(utm_campaign);

  if (!normSource || !normCampaign) {
    return NextResponse.json({ error: "utm_source 또는 utm_campaign을 알아볼 수 있는 영문/숫자로 입력해주세요." }, { status: 400 });
  }

  let data = null;
  let error = null;
  let success = false;

  for (let i = 0; i < 5; i++) {
    // 4~6자 a-z0-9. Math.random().toString(36).substring(2, 6) generates 4 chars.
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const link_id = `${normSource}_${normCampaign}_${randomSuffix}`;
    
    if (!/^[a-z0-9_]+$/.test(link_id)) {
      console.error(`[admin/acquisition/links] Validation failed for link_id: ${link_id}`);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }

    const res = await supabase.from("acquisition_links").insert({
      link_id,
      channel_name,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content: utm_content || null,
      purpose,
      destination_path: destination_path || "/",
      status: status || "ACTIVE",
      memo: memo || null,
      starts_at: starts_at || null,
      ends_at: ends_at || null,
      created_by: actor.id
    }).select().single();

    data = res.data;
    error = res.error;

    if (!error) {
      success = true;
      break;
    }

    if (error.code === '23505') {
      continue;
    }
    
    break;
  }

  if (!success) {
    console.error("[admin/acquisition/links] POST error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ link: data });
}
