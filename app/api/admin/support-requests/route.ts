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
    // PostgREST의 .or() 필터 문법에서 쉼표/괄호/공백은 예약문자다(SQL Injection이
    // 아니라 PostgREST 필터 파서 injection). Codex 지적: 백슬래시만 앞에 붙이는
    // 방식은 PostgREST 공식 문법이 아니다 - 공식 방식은 값 전체를 큰따옴표로 감싸고
    // 그 안의 큰따옴표(")와 백슬래시(\)만 이스케이프하는 quoted-value 문법이다
    // (https://docs.postgrest.org/en/v13/references/api/url_grammar.html).
    // 백슬래시를 먼저 이스케이프해야 그 다음에 이스케이프하는 큰따옴표의 백슬래시와
    // 겹치지 않는다.
    const escaped = search.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    query = query.or(`request_number.ilike."%${escaped}%",subject.ilike."%${escaped}%",body.ilike."%${escaped}%"`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data });
}
