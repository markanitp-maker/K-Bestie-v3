import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { GET as getUsageOverview } from "../route";

export const runtime = "nodejs";

type ExportFormat = "csv" | "xlsx" | "json";
type ExportCell = string | number | boolean | null | undefined;
type ExportRow = Record<string, ExportCell>;

function csvEscape(value: ExportCell): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: ExportRow[]): string {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  return `\uFEFF${header}\n${body}`;
}

function flattenOverview(data: any): {
  meta: ExportRow[];
  categories: ExportRow[];
  skus: ExportRow[];
  internalUsage: ExportRow[];
  combined: ExportRow[];
} {
  const common = {
    environment: data.environment,
    period: data.period,
    range_start_kst: data.range?.startDate,
    range_end_kst: data.range?.endDate,
    timezone: data.range?.timezone,
    billing_basis: data.billingBasis,
    latest_billing_data_kst: data.actualCost?.latestDataAtKst,
    project_scope: (data.actualCost?.projectScope ?? []).join("|"),
  };
  const meta: ExportRow[] = [
    {
      ...common,
      actual_gross_krw: data.actualCost?.grossKrw,
      credit_krw: data.actualCost?.creditKrw,
      actual_net_krw: data.actualCost?.netKrw,
      fixed_infra_krw: data.companyWideCost?.fixedInfraKrw,
      total_incurred_krw: data.companyWideCost?.totalIncurredKrw,
      expected_cash_outlay_krw: data.companyWideCost?.expectedCashOutlayKrw,
      estimate_coverage_pct: data.reconciliation?.coveragePct,
    },
  ];
  const categories: ExportRow[] = (data.costBreakdown ?? []).map((row: any) => ({
    ...common,
    category_key: row.key,
    category_label: row.label,
    category_type: row.category,
    usage: row.usage,
    usage_unit: row.usageUnit,
    gross_krw: row.grossKrw,
    credit_krw: row.creditKrw,
    net_krw: row.netKrw,
    internal_estimate_krw: row.estimateKrw,
    variance_krw: row.varianceKrw,
    share_pct: row.sharePct,
  }));
  const skus: ExportRow[] = (data.actualCost?.skuRows ?? []).map((row: any) => ({
    ...common,
    project_id: row.projectId,
    project_name: row.projectName,
    service_id: row.serviceId,
    service: row.service,
    sku_id: row.skuId,
    sku: row.sku,
    category: row.category,
    gross_krw: row.cost?.grossCostKrw,
    credit_krw: row.cost?.creditKrw,
    net_krw: row.cost?.netCostKrw,
  }));
  const internalUsage: ExportRow[] = Object.entries(data.internalUsage ?? {}).map(([kind, value]) => ({
    ...common,
    kind,
    ...((value as Record<string, ExportCell>) ?? {}),
  }));
  const combined = [
    ...meta.map((row) => ({ section: "summary", ...row })),
    ...categories.map((row) => ({ section: "category", ...row })),
    ...skus.map((row) => ({ section: "service_sku", ...row })),
    ...internalUsage.map((row) => ({ section: "internal_usage", ...row })),
  ];
  return { meta, categories, skus, internalUsage, combined };
}

// The export deliberately consumes the same API payload used by the screen.
// This keeps filters, KST boundaries and billing totals identical in UI/CSV/XLSX.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const rawFormat = (req.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();
  const format: ExportFormat = rawFormat === "xlsx" || rawFormat === "json" ? rawFormat : "csv";
  if (format === "json" && process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "JSON export is available only in dev/QA environments." }, { status: 403 });
  }

  const sourceResponse = await getUsageOverview(req);
  if (!sourceResponse.ok) return sourceResponse;
  const overview = await sourceResponse.json();
  const rows = flattenOverview(overview);
  const stamp = `${overview.period}-${overview.range?.endDate ?? new Date().toISOString().slice(0, 10)}`;

  if (format === "json") {
    return NextResponse.json({ ...overview, exportSections: rows });
  }

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.meta), "Summary");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.categories), "Categories");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.skus), "Service-SKU");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.internalUsage), "Internal Usage");
    const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="billing-${stamp}.xlsx"`,
      },
    });
  }

  return new NextResponse(rowsToCsv(rows.combined), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="billing-${stamp}.csv"`,
    },
  });
}
