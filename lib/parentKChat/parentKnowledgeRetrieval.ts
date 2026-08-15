import type { SupabaseClient } from "@supabase/supabase-js";
import { searchMemoryFactsDetailed, type SearchMemoryFactsResult } from "@/lib/memory/vectorRetrieval";
import { meaningfulReportSectionContent } from "@/lib/reports/reportSectionAvailability";
import {
  parentSourcePriority,
  resolveTemporalFromUserContext,
  temporalMatchForEvidence,
  type ParentTemporalMatch,
  type ParentTemporalResolution,
} from "@/lib/parentKChat/temporalQuery";

export type ParentKnowledgeSource = "daily_report" | "dashboard" | "weekly_report" | "detailed_report" | "memory_fact";

export interface ParentConversationTurn {
  role: "user" | "k";
  text: string;
  askChildProposal?: string | null;
  lastUnknownDetail?: string | null;
  targetDate?: string | null;
}

export interface ParentKnowledgeEvidence {
  id: string;
  source: ParentKnowledgeSource;
  date: string;
  area: string;
  content: string;
  relevance: number;
  confidence: number;
  businessDate: string | null;
  sourceDate: string | null;
  temporalMatch: ParentTemporalMatch;
  primary: boolean;
}

export type ParentKnowledgeRetrievalResult =
  | { status: "ok"; evidence: ParentKnowledgeEvidence[]; contextText: string; effectiveQuery: string; temporal: ParentTemporalResolution }
  | { status: "no_data"; effectiveQuery: string; temporal: ParentTemporalResolution }
  | { status: "error"; reason: string; effectiveQuery: string; temporal: ParentTemporalResolution };

interface RetrieveOptions {
  childId: string;
  query: string;
  conversationContext?: ParentConversationTurn[];
  allowDetailedReports: boolean;
  topK?: number;
  now?: Date;
  temporal?: ParentTemporalResolution;
}

export interface RetrievalDependencies {
  searchMemory?: typeof searchMemoryFactsDetailed;
  loadDaily?: typeof loadDailyReports;
  loadWeekly?: typeof loadWeeklyReports;
}

const DAILY_DETAIL_FIELDS: Array<[string, string]> = [
  ["school_academy_life", "학교·학원 생활"],
  ["peer_friendship", "친구 관계"],
  ["emotion_hint", "마음 흐름"],
  ["interests_preferences", "관심사·취향"],
  ["study_concerns", "공부 고민"],
  ["digital_content_interests", "디지털·콘텐츠"],
  ["future_dreams", "꿈·미래"],
  ["teacher_adults", "선생님·어른"],
  ["recurring_stories", "반복 이야기"],
];

const SOURCE_LABEL: Record<ParentKnowledgeSource, string> = {
  daily_report: "일일 리포트",
  dashboard: "부모 대시보드",
  weekly_report: "주간 리포트",
  detailed_report: "상세 리포트",
  memory_fact: "누적 기억",
};

const SYNONYM_GROUPS = [
  ["야외", "밖", "공원", "놀이터", "산책", "활동", "놀이"],
  ["공부", "학업", "수학", "숙제", "문제", "과목", "부담", "힘들"],
  ["게임", "로블록스", "마인크래프트", "콘텐츠", "영상", "유튜브", "디지털"],
  ["친구", "또래", "관계", "갈등", "싸움", "놀이"],
  ["기분", "감정", "마음", "속상", "즐거", "행복", "화나", "불안"],
  ["학교", "학원", "선생님", "수업", "교실"],
  ["좋아", "관심", "취향", "즐기", "자주", "원래", "평소"],
];

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, " ").trim()
    : "";
}

function compact(value: unknown): string {
  return normalize(value).replace(/\s+/g, "");
}

function safeContent(value: unknown): string | null {
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(" · ");
    return meaningfulReportSectionContent(joined);
  }
  return meaningfulReportSectionContent(typeof value === "string" ? value : null);
}

export function buildEffectiveParentQuery(query: string, context: ParentConversationTurn[] = []): string {
  const current = query.trim().slice(0, 300);
  const followUp = /^(원래도|평소에도|계속|자주|그것도|그런|그래|왜|어때|정말)/.test(current) || current.length <= 12;
  if (!followUp) return current;
  const recent = context
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .map((turn) => turn.text.trim().slice(0, 240))
    .filter(Boolean);
  return [...recent, current].join("\n").slice(-900);
}

export function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  const terms = new Set(normalized.split(/\s+/).filter((term) => term.length >= 2));
  const queryCompact = compact(query);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((term) => queryCompact.includes(term))) group.forEach((term) => terms.add(term));
  }
  return Array.from(terms).slice(0, 32);
}

export function scoreParentEvidence(query: string, evidence: Pick<ParentKnowledgeEvidence, "content" | "area" | "date">, now = new Date()): number {
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  const content = compact(evidence.content);
  const area = compact(evidence.area);
  let matches = 0;
  for (const term of terms) {
    if (content.includes(term)) matches += 1;
    else if (area.includes(term)) matches += 0.65;
  }
  if (matches === 0) return 0;
  const base = matches / Math.min(Math.max(terms.length, 1), 6);
  const evidenceDate = evidence.date.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? evidence.date;
  const date = new Date(`${evidenceDate}T00:00:00Z`);
  const ageDays = Number.isNaN(date.getTime()) ? 365 : Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  const recency = Math.max(0, 0.14 - ageDays * 0.002);
  return Math.min(1, Number((base + recency).toFixed(4)));
}

function evidenceFromText(source: ParentKnowledgeSource, recordId: string, date: string, area: string, value: unknown): ParentKnowledgeEvidence | null {
  const content = safeContent(value);
  if (!content) return null;
  const sourceDate = date.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? null;
  return {
    id: `${source}:${recordId}:${area}`,
    source,
    date,
    area,
    content,
    relevance: 0,
    confidence: 0.85,
    businessDate: source === "daily_report" || source === "dashboard" || source === "detailed_report" ? sourceDate : null,
    sourceDate,
    temporalMatch: "NONE",
    primary: true,
  };
}

export function extractReportEvidence(dailyRows: any[], weeklyRows: any[], allowDetailedReports: boolean): ParentKnowledgeEvidence[] {
  const evidence: ParentKnowledgeEvidence[] = [];
  const dashboardSeen = new Set<string>();

  for (const report of dailyRows) {
    const date = String(report.business_date || report.created_at || "").slice(0, 10);
    const id = String(report.id || date || "daily");
    const summary = evidenceFromText("daily_report", id, date, "오늘의 한마디", report.summary_line);
    if (summary) evidence.push(summary);

    if (report.dashboard_cards && typeof report.dashboard_cards === "object") {
      for (const [field, label] of DAILY_DETAIL_FIELDS) {
        if (dashboardSeen.has(field)) continue;
        const item = evidenceFromText("dashboard", id, date, label, report.dashboard_cards[field]);
        if (item) {
          dashboardSeen.add(field);
          evidence.push(item);
        }
      }
    }

    if (allowDetailedReports) {
      const parentGuide = evidenceFromText("detailed_report", id, date, "부모 가이드", report.parent_guide);
      if (parentGuide) evidence.push(parentGuide);
      for (const [field, label] of DAILY_DETAIL_FIELDS) {
        const item = evidenceFromText("detailed_report", id, date, label, report[field]);
        if (item) evidence.push(item);
      }
    }
  }

  for (const weekly of weeklyRows) {
    const date = String(weekly.week_end || weekly.created_at || "").slice(0, 10);
    const period = weekly.week_start && weekly.week_end ? `${weekly.week_start}~${weekly.week_end}` : date;
    const id = String(weekly.id || period || "weekly");
    for (const [area, value] of [
      ["주간 요약", weekly.summary_text],
      ["주간 하이라이트", weekly.highlights],
      ["부모 가이드", weekly.parent_guide],
      ["주말 활동 제안", weekly.weekend_activity_recommendation],
    ] as Array<[string, unknown]>) {
      const item = evidenceFromText("weekly_report", id, period, area, value);
      if (item) evidence.push(item);
    }
    if (allowDetailedReports) {
      const detail = evidenceFromText("detailed_report", id, period, "주간 상세", weekly.detail_text);
      if (detail) evidence.push(detail);
      if (weekly.detail_dashboard_cards && typeof weekly.detail_dashboard_cards === "object") {
        for (const [area, value] of Object.entries(weekly.detail_dashboard_cards)) {
          const item = evidenceFromText("detailed_report", id, period, String(area), value);
          if (item) evidence.push(item);
        }
      }
    }
  }
  return evidence;
}

export function rankAndDedupeParentEvidence(
  query: string,
  evidence: ParentKnowledgeEvidence[],
  topK = 10,
  temporal: ParentTemporalResolution = resolveTemporalFromUserContext(query, []),
): ParentKnowledgeEvidence[] {
  const ranked = evidence
    .map((item) => {
      const temporalMatch = temporalMatchForEvidence(item.date, temporal);
      const semanticRelevance = item.source === "memory_fact" ? item.relevance : scoreParentEvidence(query, item);
      const dateScopedRelevance = temporalMatch === "EXACT" && item.source !== "memory_fact"
        ? Math.max(semanticRelevance, 0.16)
        : semanticRelevance;
      return {
        ...item,
        temporalMatch,
        primary: temporalMatch !== "MISMATCH",
        relevance: dateScopedRelevance,
      };
    })
    .filter((item) => item.primary && item.relevance >= 0.16)
    .sort((a, b) =>
      parentSourcePriority(temporal.kind, a.source) - parentSourcePriority(temporal.kind, b.source)
      || b.relevance - a.relevance
      || b.date.localeCompare(a.date)
    );

  const result: ParentKnowledgeEvidence[] = [];
  const seen = new Set<string>();
  const perSource = new Map<ParentKnowledgeSource, number>();
  for (const item of ranked) {
    const fingerprint = compact(item.content);
    if (!fingerprint || seen.has(fingerprint)) continue;
    const sourceCount = perSource.get(item.source) ?? 0;
    if (sourceCount >= 4) continue;
    seen.add(fingerprint);
    perSource.set(item.source, sourceCount + 1);
    result.push(item);
    if (result.length >= topK) break;
  }
  return result;
}

export function formatParentKnowledgeContext(evidence: ParentKnowledgeEvidence[], maxChars = 5_500): string {
  let output = "";
  for (const item of evidence) {
    const block = `[${SOURCE_LABEL[item.source]} / ${item.date}]\n${item.area}: ${item.content}\n`;
    if (output.length + block.length > maxChars) break;
    output += block;
  }
  return output.trim();
}

async function loadDailyReports(
  db: SupabaseClient,
  childId: string,
  temporal: ParentTemporalResolution,
): Promise<{ rows: any[]; error: string | null }> {
  const rows: any[] = [];
  const foundDashboardFields = new Set<string>();
  const pageSize = 100;
  for (let from = 0; ; from += pageSize) {
    let query = db
      .from("daily_reports")
      .select("id, child_id, business_date, created_at, summary_line, parent_guide, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, teacher_adults, recurring_stories")
      .eq("child_id", childId)
      .is("deleted_at", null);
    if (temporal.kind === "EXACT_DATE" && temporal.targetDate) query = query.eq("business_date", temporal.targetDate);
    if ((temporal.kind === "DATE_RANGE" || temporal.kind === "RECENT") && temporal.dateRange) {
      query = query.gte("business_date", temporal.dateRange.from).lte("business_date", temporal.dateRange.to);
    }
    const { data, error } = await query
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) return { rows, error: error.message || "daily_report_error" };
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    for (const report of page) {
      if (!report.dashboard_cards || typeof report.dashboard_cards !== "object") continue;
      for (const [field] of DAILY_DETAIL_FIELDS) if (safeContent(report.dashboard_cards[field])) foundDashboardFields.add(field);
    }
    if (page.length < pageSize || (rows.length >= 30 && foundDashboardFields.size === DAILY_DETAIL_FIELDS.length)) break;
  }
  return { rows, error: null };
}

async function loadWeeklyReports(
  db: SupabaseClient,
  childId: string,
  temporal: ParentTemporalResolution,
): Promise<{ rows: any[]; error: string | null }> {
  if (temporal.kind === "EXACT_DATE") return { rows: [], error: null };
  let query = db.from("weekly_summaries")
    .select("id, child_id, week_start, week_end, created_at, summary_text, highlights, parent_guide, weekend_activity_recommendation, detail_text, detail_dashboard_cards")
    .eq("child_id", childId)
    .is("deleted_at", null);
  if ((temporal.kind === "DATE_RANGE" || temporal.kind === "RECENT") && temporal.dateRange) {
    query = query.lte("week_start", temporal.dateRange.to).gte("week_end", temporal.dateRange.from);
  }
  const { data, error } = await query
    .order("week_start", { ascending: false })
    .limit(8);
  return { rows: Array.isArray(data) ? data : [], error: error?.message ?? null };
}

export async function retrieveParentKContext(db: SupabaseClient, options: RetrieveOptions, dependencies: RetrievalDependencies = {}): Promise<ParentKnowledgeRetrievalResult> {
  const effectiveQuery = buildEffectiveParentQuery(options.query, options.conversationContext);
  const temporal = options.temporal ?? resolveTemporalFromUserContext(options.query, options.conversationContext ?? [], options.now);
  const searchMemory = dependencies.searchMemory ?? searchMemoryFactsDetailed;
  const loadDaily = dependencies.loadDaily ?? loadDailyReports;
  const loadWeekly = dependencies.loadWeekly ?? loadWeeklyReports;
  const settled = await Promise.allSettled([
    loadDaily(db, options.childId, temporal),
    loadWeekly(db, options.childId, temporal),
    searchMemory(db, options.childId, effectiveQuery, 6),
  ]);
  const dailyResult = settled[0].status === "fulfilled" ? settled[0].value : { rows: [], error: "daily_report_exception" };
  const weeklyResult = settled[1].status === "fulfilled" ? settled[1].value : { rows: [], error: "weekly_report_exception" };
  const memoryResult: SearchMemoryFactsResult = settled[2].status === "fulfilled"
    ? settled[2].value
    : { status: "error", reason: "memory_exception" };

  const reportEvidence = extractReportEvidence(dailyResult.rows, weeklyResult.rows, options.allowDetailedReports);
  const memoryEvidence = memoryResult.status === "ok" ? memoryResult.facts.map((fact) => ({
    id: `memory_fact:${fact.factId}`,
    source: "memory_fact" as const,
    date: String(fact.sourceDate).slice(0, 10),
    area: fact.factType || "누적 기억",
    content: fact.content,
    relevance: Math.max(Number(fact.similarity || 0), Number(fact.confidence || 0) * 0.5),
    confidence: Number(fact.confidence || 0),
    businessDate: null,
    sourceDate: String(fact.sourceDate).slice(0, 10),
    temporalMatch: temporalMatchForEvidence(String(fact.sourceDate).slice(0, 10), temporal),
    primary: true,
  })) : [];

  const evidence = rankAndDedupeParentEvidence(effectiveQuery, [...reportEvidence, ...memoryEvidence], options.topK ?? 10, temporal);
  const exactPrimaryFailed = temporal.kind === "EXACT_DATE" && Boolean(dailyResult.error);
  if (exactPrimaryFailed) return { status: "error", reason: dailyResult.error || "daily_report_error", effectiveQuery, temporal };
  if (evidence.length > 0) return { status: "ok", evidence, contextText: formatParentKnowledgeContext(evidence), effectiveQuery, temporal };

  const reportFailed = Boolean(dailyResult.error || weeklyResult.error);
  const memoryFailureAffectsAnswer = temporal.kind !== "EXACT_DATE" && memoryResult.status === "error";
  if (reportFailed || memoryFailureAffectsAnswer) {
    const reasons = [dailyResult.error, weeklyResult.error, memoryResult.status === "error" ? memoryResult.reason : null].filter(Boolean);
    return { status: "error", reason: reasons.join("|") || "retrieval_error", effectiveQuery, temporal };
  }
  return { status: "no_data", effectiveQuery, temporal };
}

export type { SearchMemoryFactsResult };
