import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getSupabaseTarget } from "@/lib/supabase/env";
import { isRealCalendarDate } from "@/lib/admin/reportingDateValidation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (getSupabaseTarget() === "prod") {
    return NextResponse.json({ error: "Forbidden in prod" }, { status: 403 });
  }

  const businessDate = req.nextUrl.searchParams.get("businessDate");
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !isRealCalendarDate(businessDate)) {
    return NextResponse.json({ error: "Invalid businessDate" }, { status: 400 });
  }

  const search = req.nextUrl.searchParams.get("search")?.trim().toLowerCase() || "";
  
  const db = createServiceClient();
  
  const results = await Promise.allSettled([
    db.from("child_profiles").select("id, name"),
    db.from("chat_sessions").select("child_id, session_type").gte("started_at", `${businessDate}T00:00:00+09:00`).lte("started_at", `${businessDate}T23:59:59+09:00`),
    db.from("raw_daily_conversations").select("child_id").eq("business_date", businessDate),
    db.from("daily_reports").select("*").eq("business_date", businessDate).is("deleted_at", null)
  ]);

  const childrenRes = results[0].status === "fulfilled" ? results[0].value : { error: new Error("child_profiles 조회 실패(요청 자체가 거부됨)"), data: [] };
  const sessionRes = results[1].status === "fulfilled" ? results[1].value : { error: new Error("chat_sessions 조회 실패(요청 자체가 거부됨)"), data: [] };
  const rawRes = results[2].status === "fulfilled" ? results[2].value : { error: new Error("raw_daily_conversations 조회 실패(요청 자체가 거부됨)"), data: [] };
  const reportRes = results[3].status === "fulfilled" ? results[3].value : { error: new Error("daily_reports 조회 실패(요청 자체가 거부됨)"), data: [] };

  // codex 리뷰 지적: Promise.allSettled는 네트워크/요청 레벨 실패만 status:'rejected'로
  // 잡는다 - Supabase 쿼리 자체가 fulfilled 상태로 돌아오면서 내부 error 필드에 실패를
  // 담는 경우(예: 권한/문법 오류)는 그동안 무시되어 "0건/X"로 조용히 표시되고 있었다.
  // 네 응답 모두 fulfilled 여부와 무관하게 error 필드까지 확인한다.
  for (const [label, res] of [
    ["child_profiles", childrenRes],
    ["chat_sessions", sessionRes],
    ["raw_daily_conversations", rawRes],
    ["daily_reports", reportRes],
  ] as const) {
    if (res.error) {
      return NextResponse.json({ error: `${label} 조회 실패: ${res.error.message}` }, { status: 500 });
    }
  }

  let children = childrenRes.data || [];
  
  if (search) {
    children = children.filter((c: any) => c.name.toLowerCase().includes(search) || c.id.toLowerCase().includes(search));
  }

  const sessionsByChild = new Map<string, { mission: number, free: number }>();
  for (const s of sessionRes.data || []) {
    const counts = sessionsByChild.get(s.child_id) || { mission: 0, free: 0 };
    if (s.session_type === "mission") counts.mission++;
    else counts.free++;
    sessionsByChild.set(s.child_id, counts);
  }

  const rawByChild = new Set((rawRes.data || []).map((r: any) => r.child_id));

  // codex 리뷰 지적: 이 마이그레이션 이전에 세션당 리포트를 만들던 구조 때문에 같은
  // child_id+business_date에 레거시 중복 행이 남아있을 수 있다(하드 UNIQUE 제약 없음).
  // 정렬 없이 배열 순서대로 덮어쓰면 가장 최근 리포트를 보장하지 못해 오래된 행의
  // N/8·생성시각이 표시될 수 있으므로, created_at 기준으로 각 아이의 최신 행만 남긴다.
  const reportsByChild = new Map<string, any>();
  for (const r of reportRes.data || []) {
    const existing = reportsByChild.get(r.child_id);
    if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
      reportsByChild.set(r.child_id, r);
    }
  }

  const result = children.map((c: any) => {
    const sc = sessionsByChild.get(c.id) || { mission: 0, free: 0 };
    const collected = rawByChild.has(c.id);
    const r = reportsByChild.get(c.id);
    const reportExists = !!r;
    
    let dashboardFieldCount = null;
    let lastReportGeneratedAt = null;
    if (r) {
      const fields = [
        r.school_academy_life,
        r.peer_friendship,
        r.emotion_hint,
        r.interests_preferences,
        r.study_concerns,
        r.digital_content_interests,
        r.future_dreams,
        r.recurring_stories
      ];
      dashboardFieldCount = fields.filter((f: any) => f && String(f).trim().length > 0).length;
      lastReportGeneratedAt = r.created_at;
    }

    return {
      childId: c.id,
      name: c.name,
      missionSessionCount: sc.mission,
      freeChatSessionCount: sc.free,
      collected,
      reportExists,
      dashboardFieldCount,
      lastReportGeneratedAt
    };
  });

  if (!search) {
    result.sort((a, b) => {
      const aHas = (a.missionSessionCount + a.freeChatSessionCount) > 0 ? 1 : 0;
      const bHas = (b.missionSessionCount + b.freeChatSessionCount) > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.name.localeCompare(b.name);
    });
  }

  return NextResponse.json({
    children: result.slice(0, 50)
  });
}
