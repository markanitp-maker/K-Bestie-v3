import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const unit = (req.nextUrl.searchParams.get("unit") || "child") as "family" | "parent" | "child" | "all";
  const cohortBasis = (req.nextUrl.searchParams.get("cohortBasis") || "first_use") as "registration" | "first_use";
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const ms = (dStr: string) => new Date(dStr + "T00:00:00Z").getTime();

  function getWeekStart(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday
    const diff = (day === 0 ? -6 : 1 - day);
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  const service = createServiceClient();

  // 1. Fetch child_profiles
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test, created_at").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  // 1b. Fetch family_members (부모 유닛의 가입일/가족연결 — registration 코호트 기준에
  // 가족 생성일이 아니라 "그 부모 본인이 가입한 날짜"를 써야 초대로 나중에 합류한 보호자가
  // 왜곡되지 않는다)
  const familyMembers: any[] = [];
  let fmOffset = 0;
  while (true) {
    const { data, error } = await service.from("family_members")
      .select("id, family_id, user_id, role, joined_at, created_at")
      .in("role", ["owner_parent", "parent"])
      .order("id")
      .range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyMembers.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
  }

  const testFamilyIds = !includeTestAccounts ? await getTestFamilyIds(service) : new Set<string>();

  const validChildren = new Map<string, { familyId: string | null; createdAt: string }>();
  for (const c of childProfiles) {
    if (includeTestAccounts) {
      validChildren.set(c.id, { familyId: c.family_id, createdAt: c.created_at });
    } else {
      if (!c.is_internal_test && (!c.family_id || !testFamilyIds.has(c.family_id))) {
        validChildren.set(c.id, { familyId: c.family_id, createdAt: c.created_at });
      }
    }
  }

  // 2. Fetch families
  const allFamilies: any[] = [];
  let fOffset = 0;
  while (true) {
    const { data, error } = await service.from("families").select("id, created_at").order("id").range(fOffset, fOffset + 999);
    if (error) return NextResponse.json({ error: `families 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allFamilies.push(...data);
    if (data.length < 1000) break;
    fOffset += 1000;
  }

  const familiesMap = new Map<string, { createdAt: string }>();
  for (const f of allFamilies) {
    if (!includeTestAccounts && testFamilyIds.has(f.id)) continue;
    familiesMap.set(f.id, { createdAt: f.created_at });
  }

  // 3. Fetch behavior_events (ALL)
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("id, event_name, actor_type, actor_id, family_id, child_id, occurred_at")
      .order("occurred_at").order("id")
      .range(eOffset, eOffset + 999);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  const CHILD_EVENTS = ['mission_start', 'freechat_start', 'play_start'];
  const PARENT_EVENTS = ['parent_report_view', 'parent_conversation_topic_view'];
  const FAMILY_EVENTS = [...CHILD_EVENTS, ...PARENT_EVENTS];

  type UnitData = {
    id: string;
    familyId: string | null;
    cohortDateStr: string;
    meaningfulKstDates: Set<string>;
  };

  const units = new Map<string, UnitData>();

  if (unit === 'family' && cohortBasis === 'registration') {
    for (const [fid, f] of familiesMap.entries()) {
      units.set(fid, { id: fid, familyId: fid, cohortDateStr: toKSTDateStr(f.createdAt), meaningfulKstDates: new Set() });
    }
  } else if (unit === 'child' && cohortBasis === 'registration') {
    // 아이 본인의 실제 등록일(child_profiles.created_at)을 코호트 기준일로 쓴다 — 가족
    // 생성일(families.created_at)을 쓰면 가족이 만들어진 뒤 나중에 추가된 둘째 아이가
    // 실제 등록 이전 주차로 잘못 배치된다(codex 지적).
    for (const [cid, c] of validChildren.entries()) {
      if (c.familyId && familiesMap.has(c.familyId)) {
        units.set(cid, { id: cid, familyId: c.familyId, cohortDateStr: toKSTDateStr(c.createdAt), meaningfulKstDates: new Set() });
      }
    }
  } else if (unit === 'parent' && cohortBasis === 'registration') {
    // 부모 본인이 가족에 합류한 날짜(family_members.joined_at, 없으면 created_at)를
    // 코호트 기준일로 쓴다 — 가족 생성일을 쓰면 나중에 초대되어 합류한 두 번째 보호자의
    // 코호트가 왜곡된다(codex 지적).
    for (const fm of familyMembers) {
      if (!fm.user_id || !fm.family_id) continue;
      if (!includeTestAccounts && testFamilyIds.has(fm.family_id)) continue;
      const joinedAt = fm.joined_at || fm.created_at;
      units.set(fm.user_id, { id: fm.user_id, familyId: fm.family_id, cohortDateStr: toKSTDateStr(joinedAt), meaningfulKstDates: new Set() });
    }
  } else if (unit === 'all' && cohortBasis === 'registration') {
    // requests/063 §9 — 전체 리텐션은 부모·아이를 각각 독립 사용자로 namespace 분리해
    // 합산한다(가족 단위 dedupe 금지, parent:<id>/child:<id> 키로 우연한 UUID 충돌 방지).
    for (const [cid, c] of validChildren.entries()) {
      if (c.familyId && familiesMap.has(c.familyId)) {
        units.set(`child:${cid}`, { id: cid, familyId: c.familyId, cohortDateStr: toKSTDateStr(c.createdAt), meaningfulKstDates: new Set() });
      }
    }
    for (const fm of familyMembers) {
      if (!fm.user_id || !fm.family_id) continue;
      if (!includeTestAccounts && testFamilyIds.has(fm.family_id)) continue;
      const joinedAt = fm.joined_at || fm.created_at;
      units.set(`parent:${fm.user_id}`, { id: fm.user_id, familyId: fm.family_id, cohortDateStr: toKSTDateStr(joinedAt), meaningfulKstDates: new Set() });
    }
  }

  for (const e of allEvents) {
    if (!includeTestAccounts && e.family_id && testFamilyIds.has(e.family_id)) continue;

    let uId: string | null = null;
    let isMeaningful = false;

    if (unit === 'family') {
      uId = e.family_id;
      isMeaningful = FAMILY_EVENTS.includes(e.event_name);
    } else if (unit === 'child') {
      uId = e.child_id;
      if (uId && !validChildren.has(uId)) continue;
      isMeaningful = CHILD_EVENTS.includes(e.event_name);
    } else if (unit === 'parent') {
      if (e.actor_type === 'parent' && e.actor_id) {
        uId = e.actor_id;
        isMeaningful = PARENT_EVENTS.includes(e.event_name);
      }
    } else if (unit === 'all') {
      // requests/063 §9 — namespace 분리(parent:/child:)로 부모·아이 이벤트를 각각
      // 독립 사용자로 취급한다.
      if (e.actor_type === 'child' && e.child_id) {
        if (!validChildren.has(e.child_id)) continue;
        uId = `child:${e.child_id}`;
        isMeaningful = CHILD_EVENTS.includes(e.event_name);
      } else if (e.actor_type === 'parent' && e.actor_id) {
        uId = `parent:${e.actor_id}`;
        isMeaningful = PARENT_EVENTS.includes(e.event_name);
      }
    }

    if (!uId) continue;

    let unitData = units.get(uId);
    if (!unitData) {
      // registration 기준(family/child/parent 전부)은 이미 위에서 등록일 원본 테이블
      // (families/child_profiles/family_members)로 전량 사전 등록했으므로, 여기서 새로
      // 만들지 않는다 — family_members에 없는 고아 이벤트를 여기서 family 생성일 등
      // 부정확한 날짜로 새로 만들면 오히려 코호트 날짜가 왜곡된다.
      if (cohortBasis !== 'registration' && isMeaningful) {
        unitData = { id: uId, familyId: e.family_id, cohortDateStr: '', meaningfulKstDates: new Set() };
        units.set(uId, unitData);
      }
    }

    if (unitData && isMeaningful) {
      unitData.meaningfulKstDates.add(toKSTDateStr(e.occurred_at));
    }
  }

  if (cohortBasis === 'first_use') {
    for (const [uId, uData] of units.entries()) {
      if (uData.meaningfulKstDates.size === 0) {
        units.delete(uId);
      } else {
        const dates = Array.from(uData.meaningfulKstDates).sort();
        uData.cohortDateStr = dates[0];
      }
    }
  } else {
    for (const [uId, uData] of units.entries()) {
      if (!uData.cohortDateStr) {
        units.delete(uId);
      }
    }
  }

  const dOffsets = [1, 3, 7, 14, 30];
  const wOffsets = [1, 2, 4];

  const cohortsMap = new Map<string, any>();
  const totalSummary: any = {};
  for (const n of dOffsets) totalSummary[`d${n}`] = { num: 0, den: 0 };
  for (const n of wOffsets) totalSummary[`w${n}`] = { num: 0, den: 0 };

  const initCohort = (weekStart: string) => {
    const mm = weekStart.slice(5, 7).replace(/^0/, '');
    const dd = weekStart.slice(8, 10).replace(/^0/, '');
    const c: any = {
      cohortWeekStart: weekStart,
      cohortLabel: `${mm}/${dd} 주`,
      size: 0,
    };
    for (const d of dOffsets) {
      c[`d${d}`] = { numerator: 0, denominator: 0, rate: null };
      c[`d${d}DenominatorIds`] = [];
      c[`d${d}NumeratorIds`] = [];
    }
    for (const w of wOffsets) {
      c[`w${w}`] = { numerator: 0, denominator: 0, rate: null };
      c[`w${w}DenominatorIds`] = [];
      c[`w${w}NumeratorIds`] = [];
    }
    return c;
  };

  for (const [uId, uData] of units.entries()) {
    const weekStart = getWeekStart(uData.cohortDateStr);
    if (!cohortsMap.has(weekStart)) {
      cohortsMap.set(weekStart, initCohort(weekStart));
    }
    const c = cohortsMap.get(weekStart);
    c.size++;

    for (const n of dOffsets) {
      const targetDateStr = getOffsetDateStr(uData.cohortDateStr, n);
      const targetMs = ms(targetDateStr);
      const key = `d${n}`;

      if (targetMs <= todayMs) {
        c[key].denominator++;
        c[`${key}DenominatorIds`].push(uId);
        totalSummary[key].den++;
        
        if (uData.meaningfulKstDates.has(targetDateStr)) {
          c[key].numerator++;
          c[`${key}NumeratorIds`].push(uId);
          totalSummary[key].num++;
        }
      }
    }

    for (const n of wOffsets) {
      const startStr = getOffsetDateStr(uData.cohortDateStr, 1);
      const endStr = getOffsetDateStr(uData.cohortDateStr, n * 7);
      const startMs = ms(startStr);
      const endMs = ms(endStr);
      const key = `w${n}`;

      if (endMs <= todayMs) {
        c[key].denominator++;
        c[`${key}DenominatorIds`].push(uId);
        totalSummary[key].den++;
        
        let visited = false;
        for (const mDate of uData.meaningfulKstDates) {
          const mMs = ms(mDate);
          if (mMs >= startMs && mMs <= endMs) {
            visited = true;
            break;
          }
        }

        if (visited) {
          c[key].numerator++;
          c[`${key}NumeratorIds`].push(uId);
          totalSummary[key].num++;
        }
      }
    }
  }

  for (const c of cohortsMap.values()) {
    for (const n of dOffsets) {
      const key = `d${n}`;
      c[key].rate = c[key].denominator > 0 ? (c[key].numerator / c[key].denominator) : null;
    }
    for (const n of wOffsets) {
      const key = `w${n}`;
      c[key].rate = c[key].denominator > 0 ? (c[key].numerator / c[key].denominator) : null;
    }
  }

  for (const key of Object.keys(totalSummary)) {
    const s = totalSummary[key];
    const rate = s.den > 0 ? (s.num / s.den) : null;
    totalSummary[key] = {
      numerator: s.num,
      denominator: s.den,
      rate
    };
  }

  const cohortsArray = Array.from(cohortsMap.values()).sort((a, b) => ms(a.cohortWeekStart) - ms(b.cohortWeekStart));

  return NextResponse.json({
    unit,
    cohortBasis,
    summary: totalSummary,
    cohorts: cohortsArray,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString(),
    }
  });
}
