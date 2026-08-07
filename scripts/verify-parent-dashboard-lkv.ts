import { createClient } from "@supabase/supabase-js";
import {
  buildDashboardCardInsights,
  DASHBOARD_CARD_FIELDS,
  type DashboardCardReportRow,
} from "../lib/reports/dashboardCardInsights";

const url = process.env.QA_SUPABASE_URL;
const serviceKey = process.env.QA_SUPABASE_SERVICE_ROLE_KEY;
const environment = process.env.QA_ENVIRONMENT ?? "unknown";
if (!url || !serviceKey) throw new Error("QA Supabase credentials are required");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const targetNames = ["안서아", "안서현"];
const forbidden = ["합니다.", "새로운 이야기가 있어요", "분석을 준비 중이에요"];

interface VerifiedCard {
  field: string;
  value: string;
  observed_at: string | null;
  relative_date: string;
  latest_report_has_value: boolean;
  retained_from_past: boolean;
  never_observed: boolean;
  valid: boolean;
}

interface VerifiedChild {
  name: string;
  report_count: number;
  cards: VerifiedCard[];
}

function relativeDate(date: string | null): string {
  if (!date) return "기록 없음";
  const observed = new Date(`${date}T00:00:00+09:00`).getTime();
  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((now - observed) / 86_400_000));
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "1일 전";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return "오래전";
}

async function main() {
  const { data: children, error: childError } = await supabase
    .from("child_profiles")
    .select("id, name")
    .in("name", targetNames)
    .order("name");
  if (childError) throw childError;

  const results: VerifiedChild[] = [];
  for (const child of children ?? []) {
    const { data: reports, error: reportError } = await supabase
      .from("daily_reports")
      .select("dashboard_cards, business_date, emotion_level")
      .eq("child_id", child.id)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (reportError) throw reportError;

    const rows = (reports ?? []) as DashboardCardReportRow[];
    const insights = buildDashboardCardInsights(rows);
    const cards = DASHBOARD_CARD_FIELDS.map((field) => {
      const insight = insights[field];
      const sourceIndex = rows.findIndex((row) => {
        const cards = row.dashboard_cards as Record<string, unknown> | null;
        return typeof cards?.[field] === "string" && String(cards[field]).trim() !== "";
      });
      const latestCards = rows[0]?.dashboard_cards as Record<string, unknown> | null;
      const latestHasValue = typeof latestCards?.[field] === "string" && String(latestCards[field]).trim() !== "";
      const valid = insight.value === null || (
        insight.value.length <= 15 && !forbidden.some((phrase) => insight.value!.includes(phrase))
      );

      return {
        field,
        value: insight.value ?? "대화 정보 부족",
        observed_at: insight.last_observed_at,
        relative_date: relativeDate(insight.last_observed_at),
        latest_report_has_value: latestHasValue,
        retained_from_past: !latestHasValue && sourceIndex > 0,
        never_observed: insight.value === null,
        valid,
      };
    });

    results.push({ name: child.name, report_count: rows.length, cards });
  }

  const missingNames = targetNames.filter((name) => !results.some((result) => result.name === name));
  const allValid = missingNames.length === 0 && results.every((result) => result.cards.every((card) => card.valid));
  console.log(JSON.stringify({ environment, allValid, missingNames, children: results }, null, 2));
  if (!allValid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
