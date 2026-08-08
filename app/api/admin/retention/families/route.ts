import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr } from "@/lib/analytics/kstDate";
import { isDateInRange, resolveRetentionPeriodRange } from "@/lib/admin/retentionPeriod";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const periodParam = req.nextUrl.searchParams.get("period");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const service = createServiceClient();

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const displayRange = resolveRetentionPeriodRange(periodParam, todayStr, fromParam, toParam);

  const toMs = (iso: string) => new Date(iso).getTime();

  // Test accounts exclusion logic
  let childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }
  
  const testFamilyIds = !includeTestAccounts ? await getTestFamilyIds(service) : new Set<string>();

  // Fetch all families
  let allFamilies: any[] = [];
  let fOffset = 0;
  while (true) {
    const { data, error } = await service.from("families").select("id, created_at").order("created_at", { ascending: false }).range(fOffset, fOffset + 999);
    if (error) return NextResponse.json({ error: `families 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allFamilies.push(...data);
    if (data.length < 1000) break;
    fOffset += 1000;
  }

  if (!includeTestAccounts) {
    allFamilies = allFamilies.filter(f => !testFamilyIds.has(f.id));
  }

  const familyIds = allFamilies.map(f => f.id);

  // Fetch family_members for parentCount
  let familyMembers: any[] = [];
  let fmOffset = 0;
  while (true) {
    const { data, error } = await service.from("family_members").select("family_id, role, user_id, joined_at, created_at").in("role", ["owner_parent", "parent"]).range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyMembers.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
  }

  // requests/062 §3 — 가족명이 없으므로 "대표 부모(owner_parent, 없으면 가장 먼저 합류한
  // 부모) 이름 가족 (로그인 아이디)" 형식으로 표시한다.
  const representativeParentIdByFamily = new Map<string, string>();
  for (const fid of familyIds) {
    const members = familyMembers.filter(fm => fm.family_id === fid);
    const owner = members.find(fm => fm.role === "owner_parent") || members[0];
    if (owner?.user_id) representativeParentIdByFamily.set(fid, owner.user_id);
  }
  const repParentIds = Array.from(new Set(representativeParentIdByFamily.values()));
  const parentInfoMap = new Map<string, { name: string | null; email: string | null }>();
  if (repParentIds.length > 0) {
    const { data: parentsData } = await service.from("parents").select("id, name, email").in("id", repParentIds);
    for (const p of parentsData || []) parentInfoMap.set(p.id, { name: p.name, email: p.email });
  }

  // Fetch behavior_events for activities
  let allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("family_id, event_name, occurred_at")
      .in("event_name", [
        "parent_report_view", "parent_conversation_topic_view",
        "mission_start", "freechat_start", "play_start"
      ]);
    if (displayRange.fromStr) q = q.gte("occurred_at", `${displayRange.fromStr}T00:00:00+09:00`);
    q = q.lte("occurred_at", `${displayRange.toStr}T23:59:59.999+09:00`).range(eOffset, eOffset + 999);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }
  
  if (!includeTestAccounts) {
    allEvents = allEvents.filter(e => !e.family_id || !testFamilyIds.has(e.family_id));
  }

  const parentEventNames = ["parent_report_view", "parent_conversation_topic_view"];
  const childEventNames = ["mission_start", "freechat_start", "play_start"];

  const families = allFamilies.map(f => {
    const fMembers = familyMembers.filter(fm => fm.family_id === f.id);
    const parentCount = fMembers.length;
    const childCount = childProfiles.filter(cp => cp.family_id === f.id && (!cp.is_internal_test || includeTestAccounts)).length;
    
    const fEvents = allEvents.filter(e => e.family_id === f.id && isDateInRange(toKSTDateStr(e.occurred_at), displayRange));
    const parentEvents = fEvents.filter(e => parentEventNames.includes(e.event_name));
    const childEvents = fEvents.filter(e => childEventNames.includes(e.event_name));

    let lastParentActivityAt: string | null = null;
    let maxParentMs = 0;
    for (const pe of parentEvents) {
      const ms = toMs(pe.occurred_at);
      if (ms > maxParentMs) {
        maxParentMs = ms;
        lastParentActivityAt = pe.occurred_at;
      }
    }

    let lastChildActivityAt: string | null = null;
    let maxChildMs = 0;
    for (const ce of childEvents) {
      const ms = toMs(ce.occurred_at);
      if (ms > maxChildMs) {
        maxChildMs = ms;
        lastChildActivityAt = ce.occurred_at;
      }
    }

    const hasParentActivity = parentEvents.length > 0;
    const hasChildActivity = childEvents.length > 0;
    const dualActivePeriod = hasParentActivity && hasChildActivity;
    const activeDaysTotal = new Set(fEvents.map(e => toKSTDateStr(e.occurred_at))).size;

    const repParentId = representativeParentIdByFamily.get(f.id);
    const repInfo = repParentId ? parentInfoMap.get(repParentId) : undefined;
    const repParentName = repInfo?.name?.trim() || null;
    const repLoginId = repInfo?.email?.trim() || null;
    const familyDisplayLabel = repParentName
      ? `${repParentName} 가족${repLoginId ? ` (${repLoginId})` : ""}`
      : (repLoginId || `${f.id.substring(0, 8)}...`);

    return {
      familyId: f.id,
      createdAt: f.created_at,
      parentCount,
      childCount,
      lastParentActivityAt,
      lastChildActivityAt,
      dualActive7d: dualActivePeriod,
      dualActivePeriod,
      activeDaysTotal,
      missionCount: childEvents.filter(e => e.event_name === "mission_start").length,
      freechatCount: childEvents.filter(e => e.event_name === "freechat_start").length,
      playCount: childEvents.filter(e => e.event_name === "play_start").length,
      reportViewCount: parentEvents.filter(e => e.event_name === "parent_report_view").length,
      representativeParentName: repParentName,
      representativeLoginId: repLoginId,
      displayLabel: familyDisplayLabel,
      maskedId: `${f.id.substring(0, 8)}...`,
    };
  });

  return NextResponse.json({
    families,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString(),
      period: { key: periodParam || "7d", from: displayRange.fromStr, to: displayRange.toStr },
    }
  });
}
