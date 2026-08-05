import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { resolveRetentionPeriodRange } from "@/lib/admin/retentionPeriod";
import { computeChildActivityMetrics } from "@/lib/admin/retentionChildMetrics";

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
  const periodParam = req.nextUrl.searchParams.get("period");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const service = createServiceClient();
  const toMs = (iso: string) => new Date(iso).getTime();

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const displayRange = resolveRetentionPeriodRange(periodParam, todayStr, fromParam, toParam);

  // 1. Check family existence and test status
  const { data: family, error: familyErr } = await service.from("families").select("id, created_at").eq("id", familyId).maybeSingle();
  if (familyErr) return NextResponse.json({ error: `families 조회 실패: ${familyErr.message}` }, { status: 500 });
  if (!family) return NextResponse.json({ error: "Family not found" }, { status: 404 });

  // Check if family has any test accounts
  const testFamilyIds = !includeTestAccounts ? await getTestFamilyIds(service) : new Set<string>();
  if (!includeTestAccounts && testFamilyIds.has(familyId)) {
    return NextResponse.json({ error: "Test family" }, { status: 404 });
  }

  const { data: familyChildren, error: fcErr } = await service.from("child_profiles").select("id, grade").eq("family_id", familyId);
  if (fcErr) return NextResponse.json({ error: `child_profiles 조회 실패: ${fcErr.message}` }, { status: 500 });
  
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

  // Calculate children stats — 아이 탭(children/route.ts)과 동일한 공통 함수로
  // 계산한다. 예전엔 이 라우트가 raw mission_start 이벤트를 기간 필터·dedupe 없이
  // 그대로 세서(가족 상세 화면에만 있던 별도 버그), 같은 아이의 미션 수가 아이 탭
  // 드릴다운과 다른 숫자로 보일 수 있었다.
  // claude-review 지적: lastActivityAt은 "최근 활동" 표시용이라 선택 기간과 무관하게
  // 항상 전체 이력 기준이어야 한다(그렇지 않으면 8일 이상 미활동인데 과거 이력이 있는
  // 아이가 "활동 없음"으로 잘못 표시된다) — activeDaysTotal/missionCount 등 기간
  // 표시값과는 별도로 all-time 호출에서만 가져온다.
  const [familyMetrics, familyMetricsAllTime] = await Promise.all([
    computeChildActivityMetrics(service, childIds, displayRange),
    computeChildActivityMetrics(service, childIds, { fromStr: null, toStr: displayRange.toStr }),
  ]);
  const childrenRes = children.map(c => {
    const m = familyMetrics.get(c.id);
    const mAll = familyMetricsAllTime.get(c.id);
    return {
      childId: c.id,
      grade: c.grade,
      activeDaysTotal: m?.activeDaysTotal ?? 0,
      missionCount: m?.missionCount ?? 0,
      freechatCount: m?.freechatCount ?? 0,
      playCount: m?.playCount ?? 0,
      lastActivityAt: mAll?.lastActivityAt ?? null,
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

  // requests/017-report-check.md — daily_reports는 child_id+business_date로 통합
  // 생성되며 session_id는 신규 생성분에서 NULL일 수 있으므로, session_id 경유 대신
  // child_id + business_date(KST 기준 30일 전 날짜) 직접 조회로 바꾼다.
  const thirtyDaysAgoBusinessDate = new Date(Date.now() - 30 * 24 * 3600 * 1000 + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  let reportsData: any[] = [];
  if (childIds.length > 0) {
    let rOffset = 0;
    while (true) {
      const { data, error } = await service.from("daily_reports")
        .select("id, child_id, created_at, business_date")
        .in("child_id", childIds)
        .gte("business_date", thirtyDaysAgoBusinessDate)
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
    let maxMissionMs = 0;

    // Find most recent mission_complete in last 30 days
    const cEvents = familyEvents.filter(e => e.child_id === c.id && e.event_name === "mission_complete" && toMs(e.occurred_at) >= thirtyDaysAgoMs);
    for (const e of cEvents) {
      const ms = toMs(e.occurred_at);
      if (ms > maxMissionMs) {
        maxMissionMs = ms;
        missionCompletedAt = e.occurred_at;
      }
    }

    let reportGeneratedAt: string | null = null;
    let reportId: string | null = null;

    // requests/017-report-check.md 이후 daily_reports는 session_id가 아니라
    // child_id+business_date로 통합 생성된다(같은 아이의 그날 모든 세션이 리포트
    // 하나로 합쳐짐) — 완료 이벤트가 발생한 날짜(KST business_date)로 그 아이의
    // 리포트를 매칭한다. session_id 매칭은 더 이상 유효한 개념이 아니다(신규
    // 생성분은 session_id 자체가 NULL).
    if (missionCompletedAt) {
      const missionBusinessDate = new Date(toMs(missionCompletedAt) + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const cReports = reportsData.filter(r => r.child_id === c.id && r.business_date === missionBusinessDate);
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
