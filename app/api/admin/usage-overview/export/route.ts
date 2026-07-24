import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { normalizeConversationMode, toModeBucket, MODE_LABELS, UNCLASSIFIED_MODE } from "@/lib/plan/conversationMode";

export const runtime = "nodejs";

// GET /api/admin/usage-overview/export?period=today|7d|month&childId=&mode=&format=csv|xlsx|json
// 관리자 비용/사용량 집계 '익명 내보내기'. Plan01 §23 결정2:
//   - CSV / XLSX만 운영 관리자에 노출, JSON은 개발·QA(비-production 환경)에서만.
//   - 아이 이름·이메일·대화 원문 등 직접 식별정보는 절대 포함하지 않는다.
//   - 익명 UUID(child_id, family_id)만 사용. usage_events에는 session_id 컬럼이 없어 세션 단위는 미제공.
//   - 내보내는 값: 기간·A~E 모드·서비스(kind)·요금제(tier)별 사용량/추정원가 집계.

type Period = "today" | "7d" | "month";
type Format = "csv" | "xlsx" | "json";

type UsageRow = {
  child_id: string | null;
  tier: number | null;
  kind: string;
  conversation_mode: string | null;
  duration_sec: number | null;
  char_count: number | null;
  token_in: number | null;
  token_out: number | null;
  est_cost_krw: number | null;
};

function periodRange(period: Period, now: Date): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  if (period === "today") from.setHours(0, 0, 0, 0);
  else if (period === "7d") from.setDate(from.getDate() - 7);
  else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

function usageAmount(r: UsageRow): { amount: number; unit: string } {
  if (r.kind === "tts") return { amount: r.char_count ?? 0, unit: "chars" };
  if (r.kind === "llm") return { amount: (r.token_in ?? 0) + (r.token_out ?? 0), unit: "tokens" };
  return { amount: r.duration_sec ?? 0, unit: "sec" }; // stt / live_audio
}

interface ExportRow {
  period_from: string;
  period_to: string;
  child_id: string; // 익명 UUID
  family_id: string; // 익명 UUID
  tier: number | null;
  conversation_mode: string; // 'A'~'E' | 'unclassified'
  conversation_mode_label: string;
  kind: string;
  event_count: number;
  usage_amount: number;
  usage_unit: string;
  est_cost_krw: number;
}

function csvEscape(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const periodParam = sp.get("period");
  const period: Period = periodParam === "7d" || periodParam === "today" ? periodParam : "month";
  const filterChildId = sp.get("childId") || null;
  const rawMode = sp.get("mode");
  const filterMode = normalizeConversationMode(rawMode);
  const filterUnclassified = rawMode === UNCLASSIFIED_MODE;

  const formatParam = (sp.get("format") || "csv").toLowerCase();
  const format: Format = formatParam === "xlsx" || formatParam === "json" ? (formatParam as Format) : "csv";

  // JSON은 개발·QA(비-production) 환경에서만 허용. production 환경이면 CSV로 강등하지 않고 명시적으로 차단.
  const jsonAllowed = process.env.VERCEL_ENV !== "production";
  if (format === "json" && !jsonAllowed) {
    return NextResponse.json({ error: "JSON export is available only in dev/QA environments." }, { status: 403 });
  }

  const now = new Date();
  const { from, to } = periodRange(period, now);
  const service = createServiceClient();

  const [eventsSettled, childrenSettled] = await Promise.allSettled([
    service
      .from("usage_events")
      .select("child_id, tier, kind, conversation_mode, duration_sec, char_count, token_in, token_out, est_cost_krw")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .limit(50000),
    service.from("child_profiles").select("id, family_id"),
  ]);

  // 부분 실패는 빈 배열로 폴백(Promise.allSettled 규칙 준수).
  const allRows = (eventsSettled.status === "fulfilled" ? eventsSettled.value.data ?? [] : []) as UsageRow[];
  const childRows = (childrenSettled.status === "fulfilled" ? childrenSettled.value.data ?? [] : []) as { id: string; family_id: string | null }[];
  const familyByChild = new Map<string, string>(childRows.map((c) => [c.id, c.family_id ?? ""]));

  // childId + mode 필터 적용
  const filtered = allRows.filter((r) => {
    if (filterChildId && r.child_id !== filterChildId) return false;
    if (filterMode && r.conversation_mode !== filterMode) return false;
    if (filterUnclassified && r.conversation_mode != null) return false;
    return true;
  });

  // (child_id, tier, mode, kind) 집계 — 익명 UUID만
  const agg = new Map<string, ExportRow>();
  for (const r of filtered) {
    const childId = r.child_id ?? "";
    const bucket = toModeBucket(r.conversation_mode);
    const key = `${childId}|${r.tier ?? ""}|${bucket}|${r.kind}`;
    const { amount, unit } = usageAmount(r);
    const existing = agg.get(key);
    if (existing) {
      existing.event_count += 1;
      existing.usage_amount += amount;
      existing.est_cost_krw += r.est_cost_krw ?? 0;
    } else {
      agg.set(key, {
        period_from: from.toISOString(),
        period_to: to.toISOString(),
        child_id: childId,
        family_id: familyByChild.get(childId) ?? "",
        tier: r.tier,
        conversation_mode: bucket,
        conversation_mode_label: MODE_LABELS[bucket],
        kind: r.kind,
        event_count: 1,
        usage_amount: amount,
        usage_unit: unit,
        est_cost_krw: r.est_cost_krw ?? 0,
      });
    }
  }
  const rows = Array.from(agg.values()).sort(
    (a, b) => a.conversation_mode.localeCompare(b.conversation_mode) || a.kind.localeCompare(b.kind)
  );

  const columns: (keyof ExportRow)[] = [
    "period_from", "period_to", "child_id", "family_id", "tier",
    "conversation_mode", "conversation_mode_label", "kind",
    "event_count", "usage_amount", "usage_unit", "est_cost_krw",
  ];
  const stamp = `${period}-${to.toISOString().slice(0, 10)}`;

  if (format === "json") {
    return NextResponse.json({
      meta: { period, from: from.toISOString(), to: to.toISOString(), rowCount: rows.length, note: "anonymized aggregate (dev/QA only)" },
      rows,
    });
  }

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows, { header: columns as string[] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "usage");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="usage-export-${stamp}.xlsx"`,
      },
    });
  }

  // CSV (default)
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(",")).join("\n");
  const csv = "﻿" + header + "\n" + body; // UTF-8 BOM(엑셀 한글 깨짐 방지)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-export-${stamp}.csv"`,
    },
  });
}
