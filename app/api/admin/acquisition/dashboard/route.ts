import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";

export const runtime = "nodejs";

function toKSTDateStr(iso: string) {
  const d = new Date(iso);
  d.setHours(d.getHours() + 9);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "30d";
  const attribution = url.searchParams.get("attribution") || "signup"; // "signup" or "first"
  const includeTestAccounts = url.searchParams.get("includeTestAccounts") === "true";
  
  const filterChannel = url.searchParams.get("channel");
  const filterSource = url.searchParams.get("source");
  const filterMedium = url.searchParams.get("medium");
  const filterCampaign = url.searchParams.get("campaign");

  const now = new Date();
  let from = new Date(now);
  let to = new Date(now);

  if (period === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    from.setDate(from.getDate() - 7);
  } else if (period === "14d") {
    from.setDate(from.getDate() - 14);
  } else if (period === "30d") {
    from.setDate(from.getDate() - 30);
  } else if (period === "month") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else if (period === "last_month") {
    from.setMonth(from.getMonth() - 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setMonth(to.getMonth() + 1);
    to.setDate(0);
    to.setHours(23, 59, 59, 999);
  } else if (period === "all") {
    from = new Date(0); // Epoch
  } else if (period === "custom") {
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (startDate) from = new Date(startDate + "T00:00:00+09:00");
    if (endDate) {
      to = new Date(endDate + "T23:59:59+09:00");
    }
  }

  const supabase = createServiceClient();

  // 1. Get Test Accounts if we need to exclude them
  let testParentIds = new Set<string>();
  if (!includeTestAccounts) {
    const testFamilyIds = await getTestFamilyIds(supabase);
    if (testFamilyIds.size > 0) {
      const { data: testMembers } = await supabase.from("family_members")
        .select("user_id")
        .in("family_id", Array.from(testFamilyIds));
      if (testMembers) {
        for (const m of testMembers) {
          testParentIds.add(m.user_id);
        }
      }
    }
  }

  // 2. Fetch Links to resolve channel names & filter
  let linksQuery = supabase.from("acquisition_links").select("link_id, channel_name, utm_source, utm_medium, utm_campaign");
  if (filterChannel) linksQuery = linksQuery.eq("channel_name", filterChannel);
  if (filterSource) linksQuery = linksQuery.eq("utm_source", filterSource);
  if (filterMedium) linksQuery = linksQuery.eq("utm_medium", filterMedium);
  if (filterCampaign) linksQuery = linksQuery.eq("utm_campaign", filterCampaign);

  const { data: linksData, error: linksErr } = await linksQuery;
  if (linksErr) {
    return NextResponse.json({ error: "Failed to fetch links" }, { status: 500 });
  }
  const linkIdToChannel = new Map<string, string>();
  const validLinkIds = new Set<string>();
  for (const l of (linksData || [])) {
    linkIdToChannel.set(l.link_id, l.channel_name);
    validLinkIds.add(l.link_id);
  }

  // 3. Fetch Visits (for clicks & unique visitors)
  let visitsQuery = supabase.from("acquisition_visits")
    .select("link_id, visitor_id, is_internal_test")
    .gte("occurred_at", from.toISOString())
    .lte("occurred_at", to.toISOString());
  
  if (!includeTestAccounts) {
    visitsQuery = visitsQuery.eq("is_internal_test", false);
  }
  const { data: visitsData, error: visitsErr } = await visitsQuery;
  if (visitsErr) {
    return NextResponse.json({ error: "Failed to fetch visits" }, { status: 500 });
  }

  // 4. Fetch Events (for signup started, child added, etc.)
  const { data: eventsData, error: eventsErr } = await supabase.from("acquisition_events")
    .select("event_type, link_id, visitor_id, parent_user_id, occurred_at")
    .gte("occurred_at", from.toISOString())
    .lte("occurred_at", to.toISOString());
  if (eventsErr) {
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }

  // 5. Fetch Parent Attributions (to resolve actual attribution)
  const { data: attributionsData, error: attrErr } = await supabase.from("parent_attributions")
    .select("parent_user_id, first_touch_link_id, signup_link_id, signup_touch_at, first_touch_at");
  if (attrErr) {
    return NextResponse.json({ error: "Failed to fetch attributions" }, { status: 500 });
  }
  const attrMap = new Map<string, any>();
  for (const a of (attributionsData || [])) {
    attrMap.set(a.parent_user_id, a);
  }

  // Process data
  let totalClicks = 0;
  const uniqueVisitorsSet = new Set<string>();
  
  type ChannelStat = { 
    uniqueVisitors: Set<string>; 
    convertedVisitors: Set<string>;
    clicks: number; 
    signupStarted: number;
    parentSignup: Set<string>;
    childAdded: number;
    firstTouchSignups: Set<string>;
    signupTouchSignups: Set<string>;
    lastSignupAt: string | null;
  };
  const channelStats = new Map<string, ChannelStat>();

  function getChannelStat(channel: string) {
    if (!channelStats.has(channel)) {
      channelStats.set(channel, {
        uniqueVisitors: new Set(),
        convertedVisitors: new Set(),
        clicks: 0,
        signupStarted: 0,
        parentSignup: new Set(),
        childAdded: 0,
        firstTouchSignups: new Set(),
        signupTouchSignups: new Set(),
        lastSignupAt: null,
      });
    }
    return channelStats.get(channel)!;
  }

  // Process visits
  for (const v of (visitsData || [])) {
    if (!validLinkIds.has(v.link_id)) continue;
    const channel = linkIdToChannel.get(v.link_id) || "알 수 없음";
    totalClicks++;
    uniqueVisitorsSet.add(v.visitor_id);
    
    const cs = getChannelStat(channel);
    cs.clicks++;
    cs.uniqueVisitors.add(v.visitor_id);
  }

  let signupStartedCount = 0;
  let childAddedCount = 0;
  const parentSignupSet = new Set<string>();
  const convertedVisitorSet = new Set<string>();
  let unknownSignupsCount = 0;

  const dailyTrendMap = new Map<string, number>();

  function getAttributedLink(parentUserId: string | null, fallbackLinkId: string) {
    if (!parentUserId) return fallbackLinkId;
    const attr = attrMap.get(parentUserId);
    if (!attr) return null; // No attribution
    return attribution === "first" ? attr.first_touch_link_id : attr.signup_link_id;
  }

  for (const e of (eventsData || [])) {
    if (!includeTestAccounts && e.parent_user_id && testParentIds.has(e.parent_user_id)) continue;

    const eventType = e.event_type;
    
    if (eventType === "SIGNUP_PAGE_VIEW" || eventType === "SIGNUP_STARTED") {
      if (validLinkIds.has(e.link_id)) {
        signupStartedCount++;
        const channel = linkIdToChannel.get(e.link_id) || "알 수 없음";
        getChannelStat(channel).signupStarted++;
      }
    } else if (eventType === "CHILD_ADDED") {
      const linkId = getAttributedLink(e.parent_user_id, e.link_id);
      if (linkId && validLinkIds.has(linkId)) {
        childAddedCount++;
        const channel = linkIdToChannel.get(linkId) || "알 수 없음";
        getChannelStat(channel).childAdded++;
      }
    } else if (eventType === "PARENT_SIGNUP_COMPLETED") {
      if (!e.parent_user_id) continue;
      
      const attr = attrMap.get(e.parent_user_id);
      const linkId = getAttributedLink(e.parent_user_id, e.link_id);
      
      if (!linkId || !validLinkIds.has(linkId)) {
        if (!parentSignupSet.has(e.parent_user_id)) {
          unknownSignupsCount++;
        }
      }

      if (!parentSignupSet.has(e.parent_user_id)) {
        parentSignupSet.add(e.parent_user_id);
        
        const dateStr = toKSTDateStr(e.occurred_at);
        dailyTrendMap.set(dateStr, (dailyTrendMap.get(dateStr) || 0) + 1);
      }

      if (linkId && validLinkIds.has(linkId)) {
        const channel = linkIdToChannel.get(linkId) || "알 수 없음";
        const cs = getChannelStat(channel);
        cs.parentSignup.add(e.parent_user_id);
        // 전환율은 같은 조회 기간 안에 실제 방문이 확인된 visitor cohort만 사용한다.
        // 전체 부모 가입(미확인·과거 방문 포함)을 기간 내 방문자 수로 나누면 100%를
        // 넘을 수 있으므로, 부모 가입 KPI와 전환 cohort를 분리한다.
        if (e.visitor_id && uniqueVisitorsSet.has(e.visitor_id) && cs.uniqueVisitors.has(e.visitor_id)) {
          convertedVisitorSet.add(e.visitor_id);
          cs.convertedVisitors.add(e.visitor_id);
        }
        if (!cs.lastSignupAt || new Date(e.occurred_at) > new Date(cs.lastSignupAt)) {
          cs.lastSignupAt = e.occurred_at;
        }
      }
      
      if (attr && attr.first_touch_link_id && validLinkIds.has(attr.first_touch_link_id)) {
        const c = linkIdToChannel.get(attr.first_touch_link_id) || "알 수 없음";
        getChannelStat(c).firstTouchSignups.add(e.parent_user_id);
      }
      if (attr && attr.signup_link_id && validLinkIds.has(attr.signup_link_id)) {
        const c = linkIdToChannel.get(attr.signup_link_id) || "알 수 없음";
        getChannelStat(c).signupTouchSignups.add(e.parent_user_id);
      }
    }
  }

  const kpi = {
    totalClicks,
    uniqueVisitors: uniqueVisitorsSet.size,
    signupStarted: signupStartedCount,
    parentSignup: parentSignupSet.size,
    conversionCompletedVisitors: convertedVisitorSet.size,
    conversionRate: uniqueVisitorsSet.size > 0 ? (convertedVisitorSet.size / uniqueVisitorsSet.size) * 100 : 0,
    childAdded: childAddedCount,
    parentToChildRatio: parentSignupSet.size > 0 ? childAddedCount / parentSignupSet.size : 0,
    unknownSignups: unknownSignupsCount,
  };

  const channelTable: any[] = [];
  const channelSignups: any[] = [];
  const channelConversion: any[] = [];

  for (const [channel, stat] of channelStats.entries()) {
    const parentSignupCount = stat.parentSignup.size;
    const uvs = stat.uniqueVisitors.size;
    const conv = uvs > 0 ? (stat.convertedVisitors.size / uvs) * 100 : 0;
    
    channelTable.push({
      channel,
      uniqueVisitors: uvs,
      signupStarted: stat.signupStarted,
      parentSignup: parentSignupCount,
      childAdded: stat.childAdded,
      conversionRate: conv,
      firstTouchSignups: stat.firstTouchSignups.size,
      signupTouchSignups: stat.signupTouchSignups.size,
      lastSignupAt: stat.lastSignupAt,
    });

    if (parentSignupCount > 0) {
      channelSignups.push({ channel, count: parentSignupCount });
    }
    if (uvs > 0) {
      channelConversion.push({ channel, rate: Number(conv.toFixed(1)) });
    }
  }

  channelTable.sort((a, b) => b.parentSignup - a.parentSignup || b.conversionRate - a.conversionRate);
  channelSignups.sort((a, b) => b.count - a.count);
  channelConversion.sort((a, b) => b.rate - a.rate);

  const dailyTrend = Array.from(dailyTrendMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    kpi,
    channelSignups,
    channelConversion,
    dailyTrend,
    channelTable,
  });
}
