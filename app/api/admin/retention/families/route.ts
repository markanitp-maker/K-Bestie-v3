import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();

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
    const { data, error } = await service.from("family_members").select("family_id, role").in("role", ["owner_parent", "parent"]).range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyMembers.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
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
      ])
      .range(eOffset, eOffset + 999);
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

  // 절대 시간(과거 7일 이내였는지)만 필요하므로 KST 보정 없는 실제 UTC epoch을 그대로
  // 쓴다 — nowKST.getTime()을 쓰면 실제 시각보다 9시간 앞선 값이 돼 "최근 7일" 창이
  // 실제로는 6.625일로 좁아지는 버그가 된다(다른 라우트에서 이미 발견·수정된 것과 같은
  // 패턴).
  const sevenDaysAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const parentEventNames = ["parent_report_view", "parent_conversation_topic_view"];
  const childEventNames = ["mission_start", "freechat_start", "play_start"];

  const families = allFamilies.map(f => {
    const fMembers = familyMembers.filter(fm => fm.family_id === f.id);
    const parentCount = fMembers.length;
    const childCount = childProfiles.filter(cp => cp.family_id === f.id && (!cp.is_internal_test || includeTestAccounts)).length;
    
    const fEvents = allEvents.filter(e => e.family_id === f.id);
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

    const hasParent7d = parentEvents.some(e => toMs(e.occurred_at) >= sevenDaysAgoMs);
    const hasChild7d = childEvents.some(e => toMs(e.occurred_at) >= sevenDaysAgoMs);
    const dualActive7d = hasParent7d && hasChild7d;

    return {
      familyId: f.id,
      createdAt: f.created_at,
      parentCount,
      childCount,
      lastParentActivityAt,
      lastChildActivityAt,
      dualActive7d
    };
  });

  return NextResponse.json({
    families,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString()
    }
  });
}
