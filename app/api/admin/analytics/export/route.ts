import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { buildAnalyticsKpis } from "@/lib/admin/analytics";
import { GET as getAnalytics } from "../route";

export const runtime = "nodejs";

type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

function csvCell(value: Cell): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: Row[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}`;
}

function safeRows(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function exportRows(payload: any) {
  const common = {
    period: payload.filters?.period,
    start_date_kst: payload.filters?.from,
    end_date_kst: payload.filters?.to,
    scope: payload.filters?.scope,
    internal_test: payload.filters?.internalTest,
    timezone: payload.filters?.timezone,
  };
  const summary: Row[] = buildAnalyticsKpis(payload).map((kpi) => ({
    ...common,
    metric: kpi.key,
    label: kpi.label,
    value: kpi.value,
    unit: kpi.unit,
    numerator: kpi.numerator,
    denominator: kpi.denominator,
  }));
  const daily: Row[] = safeRows(payload.retention?.overview?.dailyTrend).map((row) => ({ ...common, ...row }));
  const cohorts: Row[] = safeRows(payload.retention?.cohort?.cohorts).map((row) => ({
    ...common,
    cohort_week: row.cohortWeekStart,
    cohort_label: row.cohortLabel,
    size: row.size,
    d1: row.d1?.rate,
    d3: row.d3?.rate,
    d7: row.d7?.rate,
    d14: row.d14?.rate,
    w2: row.w2?.rate,
  }));
  const quality: Row[] = safeRows(payload.reporting?.quality).map((row) => ({ ...common, ...row }));
  const reporting: Row[] = safeRows(payload.reporting?.reportDetails).map((row) => ({
    ...common,
    name: row.name,
    business_date: row.businessDate,
    status: row.status,
    collection_1: row.stages?.collection_1,
    collection_2: row.stages?.collection_2,
    correction: row.stages?.context_correction,
    memory_batch: row.stages?.memory_batch,
    daily_report: row.stages?.daily_report,
    error_code: row.errorCode,
  }));
  const families: Row[] = safeRows(payload.retention?.details?.families).map((row) => ({
    ...common, type: "family", name: row.displayLabel, created_at: row.createdAt, parent_count: row.parentCount, child_count: row.childCount,
    last_parent_activity: row.lastParentActivityAt, last_child_activity: row.lastChildActivityAt, dual_active: row.dualActive7d,
  }));
  const parents: Row[] = safeRows(payload.retention?.details?.parents).map((row) => ({
    ...common, type: "parent", name: row.displayLabel, last_activity: row.lastVisitAt, active_days: row.activeDaysTotal,
    report_views: row.reportViewCount, topic_views: row.topicViewCount, d1: row.d1Retained, d3: row.d3Retained, d7: row.d7Retained,
  }));
  const children: Row[] = safeRows(payload.retention?.details?.children).map((row) => ({
    ...common, type: "child", name: row.displayLabel, last_activity: row.lastVisitAt, active_days: row.activeDaysTotal,
    mission: row.missionCount, freechat: row.freechatCount, play: row.playCount, d1: row.d1Retained, d3: row.d3Retained, d7: row.d7Retained,
  }));
  return { summary, daily, cohorts, quality, reporting, details: [...families, ...parents, ...children] };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const response = await getAnalytics(req);
  if (!response.ok) return response;
  const payload = await response.json();
  const rows = exportRows(payload);
  const stamp = `${payload.filters?.from ?? "start"}-${payload.filters?.to ?? "end"}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.summary), "KPI");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.daily), "DAU");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.cohorts), "Cohort");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.quality), "Reporting Quality");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.reporting), "Reporting Detail");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.details), "User Detail");
    const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="analytics-${stamp}.xlsx"`,
      },
    });
  }

  const combined = Object.entries(rows).flatMap(([section, sectionRows]) => sectionRows.map((row) => ({ section, ...row })));
  return new NextResponse(toCsv(combined), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${stamp}.csv"`,
    },
  });
}
