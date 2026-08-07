export const DASHBOARD_CARD_FIELDS = [
  "school_academy_life",
  "peer_friendship",
  "emotion_hint",
  "interests_preferences",
  "study_concerns",
  "digital_content_interests",
  "teacher_adults",
  "recurring_stories",
] as const;

export type DashboardCardField = (typeof DASHBOARD_CARD_FIELDS)[number];

export interface DashboardCardReportRow {
  dashboard_cards: unknown;
  business_date: string | null;
  emotion_level?: "safe" | "warning" | "danger" | null;
}

export interface DashboardCardInsight {
  value: string | null;
  last_observed_at: string | null;
  recent_count: number;
  emotion_level?: "safe" | "warning" | "danger" | null;
}

export type DashboardCardInsights = Record<DashboardCardField, DashboardCardInsight>;

function emptyInsights(): DashboardCardInsights {
  return Object.fromEntries(
    DASHBOARD_CARD_FIELDS.map((field) => [
      field,
      {
        value: null,
        last_observed_at: null,
        recent_count: 0,
        ...(field === "emotion_hint" ? { emotion_level: null } : {}),
      },
    ])
  ) as DashboardCardInsights;
}

function isWithinLastSevenDays(businessDate: string, now: Date): boolean {
  const observed = new Date(`${businessDate}T00:00:00+09:00`).getTime();
  const todayKst = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now) + "T00:00:00+09:00"
  ).getTime();
  const diffDays = Math.floor((todayKst - observed) / 86_400_000);
  return diffDays >= 0 && diffDays < 7;
}

/**
 * business_date 내림차순 행을 받아 영역별 최신 dashboard_cards 값을 유지한다.
 * 빈 값은 새 관찰로 취급하지 않으므로 과거 값과 관찰일을 덮어쓰지 않는다.
 */
export function buildDashboardCardInsights(
  rows: DashboardCardReportRow[],
  now = new Date()
): DashboardCardInsights {
  const insights = emptyInsights();

  for (const row of rows) {
    if (!row.business_date || !row.dashboard_cards || typeof row.dashboard_cards !== "object") {
      continue;
    }

    const cards = row.dashboard_cards as Record<string, unknown>;
    for (const field of DASHBOARD_CARD_FIELDS) {
      const candidate = cards[field];
      if (typeof candidate !== "string" || candidate.trim() === "") continue;

      const insight = insights[field];
      if (insight.value === null) {
        insight.value = candidate;
        insight.last_observed_at = row.business_date;
        if (field === "emotion_hint") insight.emotion_level = row.emotion_level ?? null;
      }
      if (isWithinLastSevenDays(row.business_date, now)) insight.recent_count += 1;
    }
  }

  return insights;
}

export function hasAllDashboardCardInsights(insights: DashboardCardInsights): boolean {
  return DASHBOARD_CARD_FIELDS.every((field) => insights[field].value !== null);
}
