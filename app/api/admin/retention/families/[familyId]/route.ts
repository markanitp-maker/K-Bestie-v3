import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { familyId } = await params;
  if (!familyId) {
    return NextResponse.json({ error: "Missing familyId" }, { status: 400 });
  }

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();
  const toMs = (iso: string) => new Date(iso).getTime();

  // 1. Check family existence and test status
  const { data: family, error: familyErr } = await service.from("families").select("id, created_at").eq("id", familyId).maybeSingle();
  if (familyErr) return NextResponse.json({ error: `families 조회 실패: ${familyErr.message}` }, { status: 500 });
  if (!family) return NextResponse.json({ error: "Family not found" }, { status: 404 });

  // Check if family has any test accounts
  const { data: familyChildren, error: fcErr } = await service.from("child_profiles").select("id, grade, is_test_account").eq("family_id", familyId);
  if (fcErr) return NextResponse.json({ error: `child_profiles 조회 실패: ${fcErr.message}` }, { status: 500 });
  
  if (!includeTestAccounts && familyChildren?.some(c => c.is_test_account)) {
    return NextResponse.json({ error: "Test family" }, { status: 404 });
  }

  const children = familyChildren || [];
  const childIds = children.map(c => c.id);

  // 2. Fetch parents
  let parentsData: any[] = [];
  let fmOffset = 0;
  while (true) {
    const { data, error } = await service.from("family_members")
      .select("user_id, joined_at")
      .eq("family_id", familyId)
      .in("role", ["owner_parent", "parent"])
      .range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    parentsData.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
  }

  // 3. Fetch behavior_events for this family
  let familyEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    const { data, error } = await service.from("behavior_events")
      .select("actor_type, actor_id, child_id, event_name, occurred_at, session_id")
      .eq("family_id", familyId)
      .range(eOffset, eOffset + 999);
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  // Calculate parents stats
  const parentsRes = parentsData.map(p => {
    const pEvents = familyEvents.filter(e => e.actor_id === p.user_id && e.actor_type === 'parent');
    let lastActivityAt: string | null = null;
    let maxMs = 0;
    
    let reportViewCount = 0;
    let topicViewCount = 0;
    
    for (const e of pEvents) {
      if (e.event_name === "parent_report_view") reportViewCount++;
      if (e.event_name === "parent_conversation_topic_view") topicViewCount++;
      
      const ms = toMs(e.occurred_at);
      if (ms > maxMs) {
        maxMs = ms;
        lastActivityAt = e.occurred_at;
      }
    }
    
    return {
      actorId: p.user_id,
      joinedAt: p.joined_at,
      reportViewCount,
      topicViewCount,
      lastActivityAt
    };
  });

  // Calculate children stats
  const childrenRes = children.map(c => {
    const cEvents = familyEvents.filter(e => e.child_id === c.id);
    let lastActivityAt: string | null = null;
    let maxMs = 0;
    
    let missionCount = 0;
    let freechatCount = 0;
    let playCount = 0;
    
    for (const e of cEvents) {
      if (e.event_name === "mission_start") missionCount++;
      if (e.event_name === "freechat_start") freechatCount++;
      if (e.event_name === "play_start") playCount++;
      
      const ms = toMs(e.occurred_at);
      if (ms > maxMs) {
        maxMs = ms;
        lastActivityAt = e.occurred_at;
      }
    }
    
    return {
      childId: c.id,
      grade: c.grade,
      missionCount,
      freechatCount,
      playCount,
      lastActivityAt
    };
  });

  // 4. Connection Funnel (last 30 days)
  // 절대 시각 기준 "지금부터 30일 전" — KST 오프셋을 여기 섞으면 안 된다(Date.getTime()은
  // 이미 UTC epoch이므로 KST 보정을 더하면 오히려 경계가 9시간 어긋난다, codex 지적).
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  // Need chat_sessions for these children to link to daily_reports
  let sessionsData: any[] = [];
  if (childIds.length > 0) {
    let sOffset = 0;
    while (true) {
      const { data, error } = await service.from("chat_sessions")
        .select("id, child_id")
        .in("child_id", childIds)
        .gte("started_at", thirtyDaysAgoIso)
        .range(sOffset, sOffset + 999);
      if (error) return NextResponse.json({ error: `chat_sessions 조회 실패: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      sessionsData.push(...data);
      if (data.length < 1000) break;
      sOffset += 1000;
    }
  }
  const sessionIds = sessionsData.map(s => s.id);

  // Need daily_reports for these sessions
  let reportsData: any[] = [];
  if (sessionIds.length > 0) {
    let rOffset = 0;
    while (true) {
      const { data, error } = await service.from("daily_reports")
        .select("id, session_id, created_at")
        .in("session_id", sessionIds)
        .range(rOffset, rOffset + 999);
      if (error) return NextResponse.json({ error: `daily_reports 조회 실패: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      reportsData.push(...data);
      if (data.length < 1000) break;
      rOffset += 1000;
    }
  }

  // Need report_views for these reports
  const reportIds = reportsData.map(r => r.id);
  let viewsData: any[] = [];
  if (reportIds.length > 0) {
    let vOffset = 0;
    while (true) {
      const { data, error } = await service.from("report_views")
        .select("report_id, viewed_at")
        .in("report_id", reportIds)
        .range(vOffset, vOffset + 999);
      if (error) return NextResponse.json({ error: `report_views 조회 실패: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      viewsData.push(...data);
      if (data.length < 1000) break;
      vOffset += 1000;
    }
  }

  const thirtyDaysAgoMs = toMs(thirtyDaysAgoIso);

  const connectionFunnel = children.map(c => {
    let missionCompletedAt: string | null = null;
    let missionSessionId: string | null = null;
    let maxMissionMs = 0;

    // Find most recent mission_complete in last 30 days
    const cEvents = familyEvents.filter(e => e.child_id === c.id && e.event_name === "mission_complete" && toMs(e.occurred_at) >= thirtyDaysAgoMs);
    for (const e of cEvents) {
      const ms = toMs(e.occurred_at);
      if (ms > maxMissionMs) {
        maxMissionMs = ms;
        missionCompletedAt = e.occurred_at;
        missionSessionId = e.session_id ?? null;
      }
    }

    let reportGeneratedAt: string | null = null;
    let reportId: string | null = null;

    // 완료 이벤트 자체의 session_id로 daily_reports.session_id를 직접 매칭한다 — 이 아이의
    // "가장 가까운" 다른 세션 리포트를 잘못 연결하지 않도록(codex 지적: 같은 아이의 다른
    // 미션/자유대화 세션 리포트가 섞여 들어갈 위험이 있었다).
    if (missionCompletedAt && missionSessionId) {
      const cReports = reportsData.filter(r => r.session_id === missionSessionId);
      let minRepMs = Infinity;
      for (const r of cReports) {
        const rMs = toMs(r.created_at);
        if (rMs < minRepMs) {
          minRepMs = rMs;
          reportGeneratedAt = r.created_at;
          reportId = r.id;
        }
      }
    }
    
    let reportViewedAt: string | null = null;
    if (reportGeneratedAt && reportId) {
      const gMs = toMs(reportGeneratedAt);
      const cViews = viewsData.filter(v => v.report_id === reportId);
      
      let minViewMs = Infinity;
      for (const v of cViews) {
        const vMs = toMs(v.viewed_at);
        if (vMs >= gMs && vMs < minViewMs) {
          minViewMs = vMs;
          reportViewedAt = v.viewed_at;
        }
      }
    }
    
    let topicViewedAfter = false;
    if (reportViewedAt) {
      const vMs = toMs(reportViewedAt);
      const pEvents = familyEvents.filter(e => e.event_name === "parent_conversation_topic_view");
      for (const pe of pEvents) {
        if (toMs(pe.occurred_at) >= vMs) {
          topicViewedAfter = true;
          break;
        }
      }
    }
    
    return {
      childId: c.id,
      missionCompletedAt,
      reportGeneratedAt,
      reportViewedAt,
      topicViewedAfter
    };
  });

  return NextResponse.json({
    familyId: family.id,
    createdAt: family.created_at,
    parents: parentsRes,
    children: childrenRes,
    connectionFunnel,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString()
    }
  });
}
