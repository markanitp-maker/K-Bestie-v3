import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { buildAnalyticsKpis } from "@/lib/admin/analytics";
import type { ChildAnalyticsRow, ParentAnalyticsRow } from "@/lib/admin/retentionPeopleAnalytics";
import { GET as getAnalytics } from "../route";
import { GET as getChildren } from "../children/route";
import { GET as getParents } from "../parents/route";

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

function retention(value: boolean | null): string {
  return value == null ? "-" : value ? "O" : "X";
}

function childExportRows(payload: { rows?: ChildAnalyticsRow[] }): Row[] {
  return (payload.rows ?? []).map((row) => ({
    아이_이름: row.childName,
    로그인_ID: row.loginId,
    학년: row.grade,
    가족: row.familyName,
    연결_부모: row.parentNames.join(", "),
    첫_의미_사용일: row.firstMeaningfulUseAt,
    최근_사용일: row.lastActivityAt,
    최근_7일_활성일수: row.activeDaysLast7,
    최근_30일_활성일수: row.activeDaysLast30,
    연속_사용일: row.streakDays,
    D1: retention(row.d1),
    D3: retention(row.d3),
    D7: retention(row.d7),
    W2: retention(row.w2),
    미션_참여: row.missionCount,
    미션_완료: row.missionCompletedCount,
    미션_완료율: row.missionCompletionRate,
    자유대화: row.freechatCount,
    놀이: row.playCount,
    리포트_생성: row.reportGeneratedCount,
    리포트_열람: row.reportViewedCount,
    리포트_열람률: row.reportViewRate,
    부모_질문: row.parentQuestionCount,
    부모_질문_전달: row.parentQuestionDeliveredCount,
    상태: row.statuses.join(","),
  }));
}

function parentExportRows(payload: { rows?: ParentAnalyticsRow[] }): Row[] {
  return (payload.rows ?? []).map((row) => ({
    부모_이름: row.parentName,
    이메일: row.email,
    가족: row.familyName,
    연결_아이_수: row.children.length,
    연결_아이: row.children.map((child) => child.childName).join(", "),
    가족_리포트_생성: row.reportGeneratedCount,
    가족_리포트_열람: row.reportViewedCount,
    가족_리포트_열람률: row.reportViewRate,
    최근_리포트_열람일: row.latestReportViewedAt,
    부모_질문_등록: row.parentQuestionCount,
    부모_질문_전달: row.parentQuestionDeliveredCount,
    연결_아이_최근7일_평균_활성일수: row.children.length > 0
      ? Math.round((row.children.reduce((sum, child) => sum + child.activeDaysLast7, 0) / row.children.length) * 10) / 10
      : null,
    연결_아이_이탈위험_수: row.children.filter((child) => child.statuses.includes("churn_risk")).length,
    상태: row.statuses.join(","),
  }));
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
    mission: row.missionCount,
    mission_attempts: row.missionCount,
    mission_completed: row.completedMissionCount,
    mission_incomplete: row.incompleteMissionCount,
    mission_event_progress: row.missionEventCompletedCount == null ? null : `${row.missionEventCompletedCount}/60`,
    freechat: row.freechatCount, play: row.playCount, d1: row.d1Retained, d3: row.d3Retained, d7: row.d7Retained,
  }));
  return { summary, daily, cohorts, quality, reporting, details: [...families, ...parents, ...children] };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const tab = req.nextUrl.searchParams.get("tab");
  if (tab === "children" || tab === "parents") {
    const peopleUrl = new URL(`/api/admin/analytics/${tab}`, req.nextUrl.origin);
    peopleUrl.search = req.nextUrl.searchParams.toString();
    peopleUrl.searchParams.set("page", "1");
    peopleUrl.searchParams.set("pageSize", "500");
    const response = await (tab === "children" ? getChildren : getParents)(new NextRequest(peopleUrl, { headers: req.headers }));
    if (!response.ok) return response;
    const payload = await response.json();
    const peopleRows = tab === "children" ? childExportRows(payload) : parentExportRows(payload);
    const stamp = `${payload.filters?.from ?? "start"}-${payload.filters?.to ?? "end"}`;
    const label = tab === "children" ? "아이별 분석" : "부모별 분석";
    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(peopleRows), label);
      const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="analytics-${tab}-${stamp}.xlsx"`,
        },
      });
    }
    return new NextResponse(toCsv(peopleRows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${tab}-${stamp}.csv"`,
      },
    });
  }
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
