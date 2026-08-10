import { NextRequest, NextResponse } from "next/server";
import { GET as getAcquisitionDashboard } from "@/app/api/admin/acquisition/dashboard/route";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

interface AcquisitionPayload {
  kpi: Record<string, number>;
  channelSignups: Array<{ channel: string; count: number }>;
  channelConversion: Array<{ channel: string; rate: number }>;
  dailyTrend: Array<{ date: string; count: number }>;
  channelTable: Array<Record<string, unknown>>;
}

async function invoke(req: NextRequest, filters: ReturnType<typeof resolveAnalyticsKstFilters>): Promise<AcquisitionPayload> {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  // 신규 통합 분석은 모든 기간을 analyticsKst.ts에서 먼저 확정하고, 기존 유입 집계에는
  // 확정된 KST 경계만 전달한다. 기존 route가 현재 시각으로 기간을 다시 계산하지 않게 한다.
  params.set("period", "custom");
  params.set("internalTest", filters.internalTest);
  params.set("startDate", filters.from);
  params.set("endDate", filters.to);
  const url = new URL("/api/admin/acquisition/dashboard", req.nextUrl.origin);
  url.search = params.toString();
  const response = await getAcquisitionDashboard(new NextRequest(url, { headers: req.headers }));
  const payload = await response.json() as AcquisitionPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "유입 집계 조회 실패");
  return payload;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let filters;
  try {
    filters = resolveAnalyticsKstFilters(req.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }
  try {
    const payload = await invoke(req, filters);
    return NextResponse.json({ filters, ...payload, attribution: req.nextUrl.searchParams.get("attribution") ?? "signup" });
  } catch (error) {
    console.error("[admin/analytics/acquisition] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "유입 집계에 실패했습니다." }, { status: 500 });
  }
}
