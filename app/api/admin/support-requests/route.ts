import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = req.nextUrl;
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  const role = url.searchParams.get("role");
  const search = url.searchParams.get("search");

  const service = createServiceClient();
  let query = service.from("support_requests").select("*").order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);
  if (role) query = query.eq("submitter_role", role);
  if (search) {
    // PostgREST의 .or() 필터 문법에서 쉼표/괄호는 예약문자라 사용자 입력에 그대로
    // 들어가면 의도치 않은 필터 조합이 주입될 수 있다(SQL Injection이 아니라 PostgREST
    // 필터 파서 injection) - 백슬래시로 이스케이프해서 리터럴로만 취급되게 한다.
    const escaped = search.replace(/[\\,()]/g, (c) => `\\${c}`);
    query = query.or(`request_number.ilike.%${escaped}%,subject.ilike.%${escaped}%,body.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data });
}
