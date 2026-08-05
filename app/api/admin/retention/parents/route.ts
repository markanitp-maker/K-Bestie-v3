import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";
import { toDisplayFields } from "@/lib/admin/retentionDisplay";
import { resolveRetentionPeriodRange, isDateInRange } from "@/lib/admin/retentionPeriod";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const periodParam = req.nextUrl.searchParams.get("period");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  
  const filterSignupSource = req.nextUrl.searchParams.get("signup_source");
  const filterSource = req.nextUrl.searchParams.get("source");
  const filterMedium = req.nextUrl.searchParams.get("medium");
  const filterCampaign = req.nextUrl.searchParams.get("campaign");
  const filterHasAttribution = req.nextUrl.searchParams.get("has_attribution");

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();

  // 아이 탭(children/route.ts)과 동일한 원칙 — 화면에 표시되는 활성 일수/카운트는
  // 선택된 기간을 반영해야 한다. D1/D3/D7/W2 유지율은 가입일 기준 절대 경과일
  // 개념이라 기간 선택과 무관하게 항상 전체 이력에서 계산한다(아래에서 별도 처리).
  const displayRange = resolveRetentionPeriodRange(periodParam, todayStr, fromParam, toParam);

  const ms = (iso: string) => new Date(iso).getTime();

  const service = createServiceClient();

  // 1. Fetch child_profiles to identify test families
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  const allTestFamilyIds = await import("@/lib/admin/retentionFilter").then(m => m.getTestFamilyIds(service));
  const testFamilyIds = !includeTestAccounts ? allTestFamilyIds : new Set<string>();

  // 2. Fetch family_members
  const familyMembers: any[] = [];
  let fmOffset = 0;
  while (true) {
    const { data, error } = await service.from("family_members")
      .select("id, family_id, user_id, role, joined_at, created_at")
      .in("role", ["owner_parent", "parent"])
      .not("user_id", "is", null)
      .not("family_id", "is", null)
      .order("id")
      .range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyMembers.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
  }

  const validParents = [];
  for (const fm of familyMembers) {
    if (!includeTestAccounts && testFamilyIds.has(fm.family_id)) continue;
    validParents.push({
      actorId: fm.user_id,
      familyId: fm.family_id,
      joinedAt: fm.joined_at || fm.created_at,
      isTestAccount: allTestFamilyIds.has(fm.family_id),
    });
  }

  // requests/062 — 이름·로그인 아이디 조인(부모 본인 로그인 값 = parents.email,
  // 아이 로그인 아이디와 혼동 금지). N+1 방지 위해 배치 조회.
  const parentIds = validParents.map(p => p.actorId).filter(Boolean);
  const parentInfoMap = new Map<string, { name: string | null; email: string | null }>();
  if (parentIds.length > 0) {
    const { data: parentsData } = await service.from("parents").select("id, name, email").in("id", parentIds);
    for (const p of parentsData || []) {
      parentInfoMap.set(p.id, { name: p.name, email: p.email });
    }
  }

  // 2.5 Fetch attributions and links
  const parentAttributionsMap = new Map<string, any>();
  if (parentIds.length > 0) {
    const { data: attData } = await service
      .from("parent_attributions")
      .select("parent_user_id, signup_link_id, first_touch_link_id")
      .in("parent_user_id", parentIds);

    const linkIds = new Set<string>();
    for (const a of attData || []) {
      if (a.signup_link_id) linkIds.add(a.signup_link_id);
      if (a.first_touch_link_id) linkIds.add(a.first_touch_link_id);
    }

    const linksMap = new Map<string, any>();
    if (linkIds.size > 0) {
      const { data: linksData } = await service
        .from("acquisition_links")
        .select("link_id, channel_name, utm_source, utm_medium, utm_campaign, utm_content")
        .in("link_id", Array.from(linkIds));
      for (const l of linksData || []) linksMap.set(l.link_id, l);
    }

    for (const a of attData || []) {
      parentAttributionsMap.set(a.parent_user_id, {
        ...a,
        signupLink: a.signup_link_id ? linksMap.get(a.signup_link_id) : null,
        firstTouchLink: a.first_touch_link_id ? linksMap.get(a.first_touch_link_id) : null,
      });
    }
  }

  // 3. Fetch behavior_events for parents
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("id, event_name, actor_id, occurred_at")
      .eq("actor_type", "parent")
      .order("occurred_at").order("id")
      .range(eOffset, eOffset + 999);
    
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  // Calculate metrics per parent
  const parentStats = new Map<string, any>();
  for (const p of validParents) {
    const info = parentInfoMap.get(p.actorId);
    const attr = parentAttributionsMap.get(p.actorId);
    parentStats.set(p.actorId, {
      ...p,
      ...toDisplayFields(p.actorId, info?.name, info?.email),
      attribution: attr || null,
      lastVisitAt: null,
      activeDaysTotal: 0,
      visitCount: 0,
      reportViewCount: 0,
      topicViewCount: 0,
      status: "가입 후 의미 행동 없음",
      d1Retained: null,
      d3Retained: null,
      d7Retained: null,
      w2Retained: null,
      _meaningfulDates: new Set<string>(), // 전체 이력(D1/D3/D7/W2용)
      _loginDatesDisplay: new Set<string>(), // 선택된 기간 내(활성 일수 표시용)
    });
  }

  for (const e of allEvents) {
    if (!e.actor_id || !parentStats.has(e.actor_id)) continue;
    const stats = parentStats.get(e.actor_id);
    const kstDate = toKSTDateStr(e.occurred_at);
    const inDisplayRange = isDateInRange(kstDate, displayRange);

    if (e.event_name === "parent_login") {
      if (inDisplayRange) {
        stats.visitCount++;
        stats._loginDatesDisplay.add(kstDate);
      }
      if (!stats.lastVisitAt || ms(e.occurred_at) > ms(stats.lastVisitAt)) {
        stats.lastVisitAt = e.occurred_at;
      }
    } else if (e.event_name === "parent_report_view") {
      if (inDisplayRange) stats.reportViewCount++;
      stats._meaningfulDates.add(kstDate);
    } else if (e.event_name === "parent_conversation_topic_view") {
      if (inDisplayRange) stats.topicViewCount++;
      stats._meaningfulDates.add(kstDate);
    }
  }

  const prev2Str = getOffsetDateStr(todayStr, -2);
  const prev6Str = getOffsetDateStr(todayStr, -6);
  const prev2Ms = ms(prev2Str);
  const prev6Ms = ms(prev6Str);

  const parentsResult = [];
  for (const stats of parentStats.values()) {
    stats.activeDaysTotal = stats._loginDatesDisplay.size;

    // requests/063 §13 CSV용 개별 D1/D3/D7/W2 — 코호트 API와 동일하게 가입일(joinedAt)을
    // Day0으로 삼는다.
    const day0Str = toKSTDateStr(stats.joinedAt);
    for (const [key, offset] of [["d1Retained", 1], ["d3Retained", 3], ["d7Retained", 7]] as const) {
      const targetStr = getOffsetDateStr(day0Str, offset);
      if (ms(targetStr) <= todayMs) {
        stats[key] = stats._meaningfulDates.has(targetStr);
      }
    }
    const w2StartStr = getOffsetDateStr(day0Str, 8);
    const w2EndStr = getOffsetDateStr(day0Str, 14);
    if (ms(w2EndStr) <= todayMs) {
      let visited = false;
      for (const d of stats._meaningfulDates as Set<string>) {
        if (ms(d) >= ms(w2StartStr) && ms(d) <= ms(w2EndStr)) { visited = true; break; }
      }
      stats.w2Retained = visited;
    }

    if (stats._meaningfulDates.size > 0) {
      // "최근 7일 미접속"이 실제로 "지난 7일간 의미있는 행동이 없었다"는 뜻이 되도록,
      // 가장 최근 의미있는 행동일을 구해 경계를 정확히 판정한다(이전에는 오늘/최근3일이
      // 아니면 무조건 이 상태로 분류해, 실제로는 4~6일 전에 활동한 부모도 "미접속"으로
      // 잘못 표시됐다 — codex 지적).
      const mostRecentMeaningfulMs = Math.max(...Array.from(stats._meaningfulDates, (d: string) => ms(d)));
      if (stats._meaningfulDates.has(todayStr)) {
        stats.status = "오늘 활성";
      } else if (mostRecentMeaningfulMs >= prev2Ms) {
        stats.status = "최근 3일 활성";
      } else if (mostRecentMeaningfulMs >= prev6Ms) {
        stats.status = "최근 7일 활성";
      } else {
        stats.status = "최근 7일 미접속";
      }
    } else {
      stats.status = "가입 후 의미 행동 없음";
    }

    delete stats._meaningfulDates;
    delete stats._loginDatesDisplay;

    // Apply filters
    if (filterSignupSource || filterSource || filterMedium || filterCampaign || filterHasAttribution) {
      const link = stats.attribution?.signupLink;
      
      if (filterHasAttribution === "true" && (!stats.attribution || !link)) continue;
      if (filterHasAttribution === "false" && (stats.attribution && link)) continue;

      if (filterSignupSource && link?.channel_name !== filterSignupSource) continue;
      if (filterSource && link?.utm_source !== filterSource) continue;
      if (filterMedium && link?.utm_medium !== filterMedium) continue;
      if (filterCampaign && link?.utm_campaign !== filterCampaign) continue;
    }

    parentsResult.push(stats);
  }

  return NextResponse.json({
    parents: parentsResult,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString(),
      period: { key: periodParam || "7d", from: displayRange.fromStr, to: displayRange.toStr },
    }
  });
}
