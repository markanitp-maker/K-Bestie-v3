import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { BILLING_CATEGORY_LABELS, fetchGcpBilling, KNOWN_BILLING_CATEGORIES, type BillingCategory, type GcpBillingResult, type GeminiUsageDimension } from "@/lib/billing/gcpBilling";
import { BillingPeriodError, formatKstDate, formatKstDateTime, prorateMonthlyCost, resolveBillingPeriodRange, type BillingPeriod, type BillingPeriodRange } from "@/lib/billing/periodRange";
import { REVENUE_MODE, VERCEL_FIXED_KRW_PER_MONTH, SUPABASE_FIXED_KRW_PER_MONTH, USD_TO_KRW, FX_AS_OF } from "@/lib/plan/pricing";
import { ALL_MODE_BUCKETS, toModeBucket, normalizeConversationMode, UNCLASSIFIED_MODE, type ModeBucket } from "@/lib/plan/conversationMode";

// 실제 GCP 청구 원가 조회 실패/미설정 시 폴백용 빈 결과.
function emptyGcpBillingResult(dataCutoffDate: string): GcpBillingResult {
  const emptyTriplet = () => ({ grossCostKrw: 0, creditKrw: 0, netCostKrw: 0 });
  return {
    configured: false,
    total: emptyTriplet(),
    totalsByCategory: {
      stt: emptyTriplet(),
      tts: emptyTriplet(),
      vertex_ai_gemini: emptyTriplet(),
      vertex_ai_embeddings: emptyTriplet(),
      live_realtime_audio: emptyTriplet(),
      cloud_run: emptyTriplet(),
      cloud_storage: emptyTriplet(),
      cloud_logging: emptyTriplet(),
      bigquery: emptyTriplet(),
      artifact_registry: emptyTriplet(),
      secret_manager: emptyTriplet(),
      other: emptyTriplet(),
    },
    skuRows: [],
    unclassified: { count: 0, services: [], cost: emptyTriplet(), ratePct: 0 },
    dataCutoffDate,
    latestDataAt: null,
    projectScope: [],
  };
}

export const runtime = "nodejs";

type Period = BillingPeriod;
type AiKind = "stt" | "tts" | "live_audio" | "llm" | "embedding";
type UsageEventRow = {
  id: string;
  child_id: string | null;
  tier: number | null;
  kind: string;
  conversation_mode: string | null;
  duration_sec: number | null;
  char_count: number | null;
  token_in: number | null;
  token_out: number | null;
  model: string | null;
  request_count: number | null;
  input_count: number | null;
  environment: string | null;
  est_cost_krw: number | null;
  created_at: string;
};

function changeRate(current: number, prev: number): number | null {
  if (prev === 0) return current === 0 ? 0 : null; // 직전 기간 데이터가 없으면 비율 계산 불가
  return ((current - prev) / Math.abs(prev)) * 100;
}

function sumCost(events: UsageEventRow[]): number {
  return events.reduce((s, e) => s + (e.est_cost_krw ?? 0), 0);
}

// GET /api/admin/usage-overview?period=today|7d|month&childId=xxx
// 관리자 대시보드 "사용량·비용" 탭 데이터 소스.
// childId 없음("전체 보기"): 회사 전체 손익 요약(+전기 대비 증감률) + 요금제별 인원 + 일별 매출/비용 추이
//   + 비용 항목별 분해(AI 4종 + 인프라 고정비, 비용 큰 순) + 서비스별 TOP10 유저 + 아이별 수익성 표.
// childId 있음(사용자 상세 드릴다운): 그 아이 하나의 세션 수 + 서비스별 사용량·비용만 반환.
// 단, 아이별 수익성 표(perChildProfitability)는 항상 전체 아이 목록 — childId 필터의 영향을 받지 않는다.
// 매출은 "가입 요금제" 기준(구독료 성격, 이번 기간 사용 여부와 무관) — child_profiles.tier 배정 금액을 그대로 합산.
// 지금은 전원 무료 제공 기간이라 실제 결제는 없고 "유료였다면"을 가정한 예상 매출이다(REVENUE_MODE 참고).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let periodRange: BillingPeriodRange;
  try {
    periodRange = resolveBillingPeriodRange({
      period: req.nextUrl.searchParams.get("period"),
      startDate: req.nextUrl.searchParams.get("startDate"),
      endDate: req.nextUrl.searchParams.get("endDate"),
    });
  } catch (error) {
    if (error instanceof BillingPeriodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const period: Period = periodRange.period;
  const filterChildId = req.nextUrl.searchParams.get("childId") || null;
  // A~E 대화방식 필터: 'A'~'E' 또는 'unclassified'(미분류) 또는 없음(전체).
  const rawModeParam = req.nextUrl.searchParams.get("mode");
  const filterMode = normalizeConversationMode(rawModeParam);
  const filterUnclassified = rawModeParam === UNCLASSIFIED_MODE;

  const now = new Date();
  const { from, to, days } = periodRange;
  // 직전 동기간 — 현재 기간과 동일한 길이만큼 바로 이전 구간.
  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

  const service = createServiceClient();

  const fetchUsageRange = async (rangeFrom: Date, rangeTo: Date): Promise<UsageEventRow[]> => {
    const pageSize = 5_000;
    const rows: UsageEventRow[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await service
        .from("usage_events")
        .select("id, child_id, tier, kind, conversation_mode, duration_sec, char_count, token_in, token_out, model, request_count, input_count, environment, est_cost_krw, created_at")
        .gte("created_at", rangeFrom.toISOString())
        .lt("created_at", rangeTo.toISOString())
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as UsageEventRow[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  };

  const [eventsSettled, prevEventsSettled, childrenSettled, plansSettled] = await Promise.allSettled([
    fetchUsageRange(from, to),
    fetchUsageRange(prevFrom, prevTo),
    service.from("child_profiles").select("id, name, tier, created_at"),
    service.from("plans").select("tier, name, price_krw"),
  ]);

  // 부분 실패는 빈 배열로 폴백해 대시보드가 깨지지 않게 한다(Promise.allSettled 규칙 준수).
  const allEvents = eventsSettled.status === "fulfilled" ? eventsSettled.value : [];
  const prevEvents = prevEventsSettled.status === "fulfilled" ? prevEventsSettled.value : [];
  const children = (childrenSettled.status === "fulfilled" ? childrenSettled.value.data ?? [] : []) as { id: string; name: string; tier: number; created_at: string }[];
  const plans = (plansSettled.status === "fulfilled" ? plansSettled.value.data ?? [] : []) as { tier: number; name: string; price_krw: number }[];

  const priceByTier = new Map<number, { name: string; price: number }>(
    plans.map((p) => [p.tier, { name: p.name, price: p.price_krw }])
  );
  const childById = new Map<string, { name: string; tier: number; createdAt: string }>(
    children.map((c) => [c.id, { name: c.name, tier: c.tier, createdAt: c.created_at }])
  );

  // childId 필터(아이 상세 드릴다운) + mode 필터(A~E/미분류)를 함께 적용해 메인 집계 대상 events를 만든다.
  const matchesMode = (e: UsageEventRow): boolean => {
    if (filterMode) return e.conversation_mode === filterMode;
    if (filterUnclassified) return e.conversation_mode == null;
    return true;
  };
  const events = allEvents.filter((e) => {
    if (filterChildId && e.child_id !== filterChildId) return false;
    return matchesMode(e);
  });

  // ── A~E 모드별 원가 배분 표 — childId 스코프만 적용(mode 필터 무관하게 항상 전체 모드 분포를 보여준다).
  //   Plan01 §23 결정1: 신규부터 conversation_mode 태깅, 기존/미지정은 '미분류(unclassified)'.
  const modeScoped = filterChildId ? allEvents.filter((e) => e.child_id === filterChildId) : allEvents;
  const costByMode: Record<ModeBucket, Record<AiKind, number>> = Object.fromEntries(
    ALL_MODE_BUCKETS.map((m) => [m, { stt: 0, tts: 0, live_audio: 0, llm: 0, embedding: 0 }])
  ) as Record<ModeBucket, Record<AiKind, number>>;
  const countByMode: Record<ModeBucket, number> = Object.fromEntries(
    ALL_MODE_BUCKETS.map((m) => [m, 0])
  ) as Record<ModeBucket, number>;
  for (const e of modeScoped) {
    const bucket = toModeBucket(e.conversation_mode);
    const kind = e.kind as AiKind;
    if (costByMode[bucket][kind] != null) costByMode[bucket][kind] += e.est_cost_krw ?? 0;
    countByMode[bucket] += 1;
  }
  const modeBreakdown = ALL_MODE_BUCKETS.map((m) => {
    const k = costByMode[m];
    const total = k.stt + k.tts + k.live_audio + k.llm;
    return { mode: m, eventCount: countByMode[m], stt: k.stt, tts: k.tts, live_audio: k.live_audio, llm: k.llm, totalKrw: total };
  });

  // ── 서비스별(kind) 집계 + 일별 비용 (childId 필터 적용된 events 기준) ──
  const totalsByKind = { stt: 0, tts: 0, live_audio: 0, llm: 0, embedding: 0 } as Record<string, number>;
  const countsByKind = { stt: 0, tts: 0, live_audio: 0, llm: 0, embedding: 0 } as Record<string, number>;
  const dailyCostEstimate: Record<string, Record<string, number>> = {};
  const usageAmountByKind = { sttSec: 0, ttsChars: 0, liveSec: 0, llmTokenIn: 0, llmTokenOut: 0, embeddingRequests: 0, embeddingInputs: 0 };

  for (const e of events) {
    const kind = e.kind;
    const cost = e.est_cost_krw ?? 0;
    totalsByKind[kind] = (totalsByKind[kind] ?? 0) + cost;
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;

    const day = formatKstDate(e.created_at);
    dailyCostEstimate[day] = dailyCostEstimate[day] ?? { stt: 0, tts: 0, live_audio: 0, llm: 0 };
    if (dailyCostEstimate[day][kind] != null) dailyCostEstimate[day][kind] += cost;

    if (kind === "stt" && e.duration_sec) usageAmountByKind.sttSec += e.duration_sec;
    if (kind === "tts" && e.char_count) usageAmountByKind.ttsChars += e.char_count;
    if (kind === "live_audio" && e.duration_sec) usageAmountByKind.liveSec += e.duration_sec;
    if (kind === "llm") {
      if (e.token_in) usageAmountByKind.llmTokenIn += e.token_in;
      if (e.token_out) usageAmountByKind.llmTokenOut += e.token_out;
    }
    if (kind === "embedding") {
      usageAmountByKind.embeddingRequests += e.request_count ?? 1;
      usageAmountByKind.embeddingInputs += e.input_count ?? 0;
    }
  }

  // 아이별/서비스별 원가 집계는 항상 "전체" 이벤트(allEvents) 기준 — perChildProfitability와
  // topUsersByService가 childId 필터의 영향을 받지 않고 항상 전체 데이터를 보여주기 위함.
  const costByChildAll = new Map<string, number>();
  // key: `${kind}:${childId}` → { usage, costKrw }
  const usageByServiceChild = new Map<string, { childId: string; kind: string; usage: number; costKrw: number }>();
  for (const e of allEvents) {
    if (!e.child_id) continue;
    costByChildAll.set(e.child_id, (costByChildAll.get(e.child_id) ?? 0) + (e.est_cost_krw ?? 0));

    const key = `${e.kind}:${e.child_id}`;
    const usageAmount =
      e.kind === "tts" ? e.char_count ?? 0 : e.kind === "llm" ? (e.token_in ?? 0) + (e.token_out ?? 0) : e.kind === "embedding" ? e.request_count ?? 1 : e.duration_sec ?? 0;
    const existing = usageByServiceChild.get(key);
    if (existing) {
      existing.usage += usageAmount;
      existing.costKrw += e.est_cost_krw ?? 0;
    } else {
      usageByServiceChild.set(key, { childId: e.child_id, kind: e.kind, usage: usageAmount, costKrw: e.est_cost_krw ?? 0 });
    }
  }

  // 트래픽 — 기간 내 대화 세션 수(chat_sessions 시작 기준, childId 필터 적용)
  let sessionCountQuery = service
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString());
  if (filterChildId) sessionCountQuery = sessionCountQuery.eq("child_id", filterChildId);
  const { count: sessionCount } = await sessionCountQuery;

  const aiCostTotal = totalsByKind.stt + totalsByKind.tts + totalsByKind.live_audio + totalsByKind.llm;
  const vercelCost = prorateMonthlyCost(VERCEL_FIXED_KRW_PER_MONTH, periodRange);
  const supabaseCost = prorateMonthlyCost(SUPABASE_FIXED_KRW_PER_MONTH, periodRange);

  // ── GCP 실제 청구액(STT/TTS/Gemini Agent Platform/Model Garden/Cloud Run/Cloud Storage) —
  // 회사 전체 청구서라 아이 단위로는 못 쪼갠다. childId 상세 드릴다운에서는 조회하지 않는다
  // (그 아이만의 실제 청구액이 따로 없음).
  const gcpBilling: GcpBillingResult = filterChildId ? emptyGcpBillingResult(now.toISOString().slice(0, 10)) : await fetchGcpBilling({ from, to });

  // Cloud Run(라이브 음성 릴레이) 실청구(크레딧 반영 순액) — 추정치가 없는 인프라라 실청구만 사용(미설정/실패 시 0).
  const cloudRunActual = gcpBilling.configured ? gcpBilling.totalsByCategory.cloud_run.netCostKrw : 0;
  // 총비용 = AI 추정 + 인프라 고정비 + Cloud Run 실청구.
  const totalCost = aiCostTotal + vercelCost + supabaseCost + cloudRunActual;

  // ── 요금제별 가입 인원 (가입 요금제 기준, 이번 기간 사용 여부와 무관) ──
  const enrolledByTier = new Map<number, number>();
  for (const c of children) {
    enrolledByTier.set(c.tier, (enrolledByTier.get(c.tier) ?? 0) + 1);
  }
  const byTier = Array.from(priceByTier.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tier, plan]) => ({ tier, name: plan.name, priceKrw: plan.price, count: enrolledByTier.get(tier) ?? 0 }));

  // ── 손익 요약 — 매출은 "가입 요금제" 기준(구독료 성격, 이번 기간 사용 여부와 무관) ──
  let projectedRevenue = 0;
  if (filterChildId) {
    const child = childById.get(filterChildId);
    projectedRevenue = child ? priceByTier.get(child.tier)?.price ?? 0 : 0;
  } else {
    projectedRevenue = byTier.reduce((sum, t) => sum + t.priceKrw * t.count, 0);
  }
  const netProfit = projectedRevenue - totalCost;

  // ── Plan01 §23 결정3: 실제 vs 예상 손익 분리(혼합 금지) ──
  //   무료 제공 기간(실결제 미도입 = REVENUE_MODE 'projected')에는 실매출 ₩0, 실손익 = 0 − 실비용.
  //   실비용은 가능하면 BigQuery 실청구(회사 전체) 기반, 미설정/드릴다운 시 추정치로 폴백.
  const isFreePeriod = REVENUE_MODE === "projected";
  // 실제 AI 비용(크레딧 반영 순액) — Vertex AI가 Gemini Agent Platform/Model Garden 두 카테고리로
  // 나뉘므로(대표님 지시: 제품 단위 Live/LLM에 임의 배분 금지) 여기서는 그대로 합산한다.
  const confirmedAiCost = gcpBilling.configured
    ? gcpBilling.totalsByCategory.stt.netCostKrw +
      gcpBilling.totalsByCategory.tts.netCostKrw +
      gcpBilling.totalsByCategory.vertex_ai_gemini.netCostKrw +
      gcpBilling.totalsByCategory.live_realtime_audio.netCostKrw +
      gcpBilling.totalsByCategory.vertex_ai_embeddings.netCostKrw
    : aiCostTotal;
  const actualTotalCost = confirmedAiCost + vercelCost + supabaseCost + cloudRunActual;
  const actualRevenue = isFreePeriod ? 0 : projectedRevenue;
  const actualNetProfit = actualRevenue - actualTotalCost;

  // ── 직전 동기간 대비 증감률 ──
  // 비용: 직전 기간 usage_events 합계 + 인프라 고정비(동일 로직).
  // 현재 기간 events와 동일한 childId+mode 필터를 이전 기간에도 적용해 증감률 집계 범위를 일치시킨다.
  const prevEventsScoped = prevEvents.filter((e) => {
    if (filterChildId && e.child_id !== filterChildId) return false;
    return matchesMode(e);
  });
  const prevAiCost = sumCost(prevEventsScoped);
  const prevTotalCost = prevAiCost + vercelCost + supabaseCost; // 고정비는 기간 길이만 같으면 동일
  // 매출: 직전 기간 "종료 시점" 이전에 가입(created_at)한 아이만 카운트 — 이 기간 동안의 신규가입 증가분을 반영.
  let prevRevenue = 0;
  if (filterChildId) {
    const child = childById.get(filterChildId);
    const existedBefore = child && new Date(child.createdAt) < prevTo;
    prevRevenue = existedBefore && child ? priceByTier.get(child.tier)?.price ?? 0 : 0;
  } else {
    const prevEnrolledByTier = new Map<number, number>();
    for (const c of children) {
      if (new Date(c.created_at) < prevTo) {
        prevEnrolledByTier.set(c.tier, (prevEnrolledByTier.get(c.tier) ?? 0) + 1);
      }
    }
    prevRevenue = Array.from(prevEnrolledByTier.entries()).reduce((sum, [tier, count]) => {
      const price = priceByTier.get(tier)?.price ?? 0;
      return sum + price * count;
    }, 0);
  }
  const prevProfit = prevRevenue - prevTotalCost;

  // ── 일별 매출·비용 추이(글랜스용) — 매출은 기간 내 총 매출을 일수만큼 균등 분배한 참고선.
  const dailyRevenuePerDay = projectedRevenue / days;
  const dailyInfraPerDay = (vercelCost + supabaseCost) / days;
  const dailyTrend = Object.keys(dailyCostEstimate)
    .sort()
    .map((day) => {
      const c = dailyCostEstimate[day];
      return { day, revenueKrw: dailyRevenuePerDay, costKrw: c.stt + c.tts + c.live_audio + c.llm + dailyInfraPerDay };
    });

  // ── 비용 항목별 분해 — 실제 GCP 청구 6종 + 인프라 고정비, 비용 큰 순 정렬 + 전체 대비 비중% ──
  // 2026-07-27 개편(대표님 지시): 로컬 usage_events 추정치를 "실제 비용"으로 취급하지 않는다.
  // Google Cloud Billing 실제값(gcpBilling)을 정본으로 하고, 로컬 추정치는 "내부 배분 원가"로
  // 별도 컬럼에만 병기한다. Gemini는 제품 단위(Live/LLM)로 임의 배분하지 않고 SKU 기준
  // Gemini/Embedding/Live는 서비스·SKU family 기준으로 독립 노출한다(estimateKrw는 참고용).
  // 근사치로만 붙인다 — 정확한 1:1 매칭이 아님을 note로 명시).
  type CostBreakdownItem = {
    key: BillingCategory | "vercel" | "supabase";
    label: string;
    category: "ai" | "infra";
    usage: number;
    usageUnit: string;
    grossKrw: number;
    creditKrw: number;
    netKrw: number;
    monthEndProjectionKrw: number;
    estimateKrw: number | null; // 내부 사용량 기반 배분 원가(참고용) — 없으면 null
    varianceKrw: number | null; // netKrw - estimateKrw (추정 오차, estimateKrw 없으면 null)
    /** @deprecated 하위호환 — confirmedCostKrw와 동일(=netKrw 또는 고정비) */
    confirmedCostKrw: number;
    /** @deprecated 하위호환 — ourEstimateKrw와 동일 */
    ourEstimateKrw: number;
    /** @deprecated 하위호환 — gcpActualKrw와 동일(=grossKrw, GCP 미설정 시 null) */
    gcpActualKrw: number | null;
    note?: string;
  };

  // 월말 예상 원가 — period=month이고 아직 월이 끝나지 않았으면 현재까지의 순청구액을
  // 경과일수 비례로 월 전체에 투영한다. 그 외 기간(today/7d)이거나 이미 지난 기간이면 net 그대로.
  const nowKst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const daysInCurrentMonth = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsedInMonth = nowKst.getUTCDate();
  function projectToMonthEnd(netKrw: number): number {
    if (period !== "month" || daysElapsedInMonth <= 0) return netKrw;
    return (netKrw / daysElapsedInMonth) * daysInCurrentMonth;
  }

  const gcpConfigured = gcpBilling.configured;
  function actualTriplet(cat: BillingCategory) {
    return gcpConfigured ? gcpBilling.totalsByCategory[cat] : { grossCostKrw: 0, creditKrw: 0, netCostKrw: 0 };
  }

  const rawBreakdown: CostBreakdownItem[] = [
    {
      key: "stt",
      label: "STT (Speech-to-Text)",
      category: "ai",
      usage: usageAmountByKind.sttSec,
      usageUnit: "sec",
      grossKrw: actualTriplet("stt").grossCostKrw,
      creditKrw: actualTriplet("stt").creditKrw,
      netKrw: actualTriplet("stt").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("stt").netCostKrw),
      estimateKrw: totalsByKind.stt,
      varianceKrw: gcpConfigured ? actualTriplet("stt").grossCostKrw - totalsByKind.stt : null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("stt").netCostKrw : totalsByKind.stt,
      ourEstimateKrw: totalsByKind.stt,
      gcpActualKrw: gcpConfigured ? actualTriplet("stt").grossCostKrw : null,
    },
    {
      key: "tts",
      label: "TTS (Text-to-Speech)",
      category: "ai",
      usage: usageAmountByKind.ttsChars,
      usageUnit: "chars",
      grossKrw: actualTriplet("tts").grossCostKrw,
      creditKrw: actualTriplet("tts").creditKrw,
      netKrw: actualTriplet("tts").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("tts").netCostKrw),
      estimateKrw: totalsByKind.tts,
      varianceKrw: gcpConfigured ? actualTriplet("tts").grossCostKrw - totalsByKind.tts : null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("tts").netCostKrw : totalsByKind.tts,
      ourEstimateKrw: totalsByKind.tts,
      gcpActualKrw: gcpConfigured ? actualTriplet("tts").grossCostKrw : null,
    },
    {
      key: "vertex_ai_gemini",
      label: BILLING_CATEGORY_LABELS.vertex_ai_gemini,
      category: "ai",
      usage: usageAmountByKind.liveSec + usageAmountByKind.llmTokenIn + usageAmountByKind.llmTokenOut,
      usageUnit: "mixed",
      grossKrw: actualTriplet("vertex_ai_gemini").grossCostKrw,
      creditKrw: actualTriplet("vertex_ai_gemini").creditKrw,
      netKrw: actualTriplet("vertex_ai_gemini").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("vertex_ai_gemini").netCostKrw),
      estimateKrw: totalsByKind.llm,
      varianceKrw: gcpConfigured ? actualTriplet("vertex_ai_gemini").grossCostKrw - totalsByKind.llm : null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("vertex_ai_gemini").netCostKrw : 0,
      ourEstimateKrw: totalsByKind.live_audio + totalsByKind.llm,
      gcpActualKrw: gcpConfigured ? actualTriplet("vertex_ai_gemini").grossCostKrw : null,
      note: "모델 버전과 무관한 Gemini text/prediction SKU family 기준",
    },
    {
      key: "vertex_ai_embeddings",
      label: BILLING_CATEGORY_LABELS.vertex_ai_embeddings,
      category: "ai",
      usage: usageAmountByKind.embeddingRequests,
      usageUnit: "requests",
      grossKrw: actualTriplet("vertex_ai_embeddings").grossCostKrw,
      creditKrw: actualTriplet("vertex_ai_embeddings").creditKrw,
      netKrw: actualTriplet("vertex_ai_embeddings").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("vertex_ai_embeddings").netCostKrw),
      estimateKrw: null,
      varianceKrw: null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("vertex_ai_embeddings").netCostKrw : 0,
      ourEstimateKrw: 0,
      gcpActualKrw: gcpConfigured ? actualTriplet("vertex_ai_embeddings").grossCostKrw : null,
      note: "호출 성공 건만 내부 사용량에 기록하며 원문은 저장하지 않음",
    },
    {
      key: "live_realtime_audio",
      label: BILLING_CATEGORY_LABELS.live_realtime_audio,
      category: "ai",
      usage: usageAmountByKind.liveSec,
      usageUnit: "sec",
      grossKrw: actualTriplet("live_realtime_audio").grossCostKrw,
      creditKrw: actualTriplet("live_realtime_audio").creditKrw,
      netKrw: actualTriplet("live_realtime_audio").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("live_realtime_audio").netCostKrw),
      estimateKrw: totalsByKind.live_audio,
      varianceKrw: gcpConfigured ? actualTriplet("live_realtime_audio").grossCostKrw - totalsByKind.live_audio : null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("live_realtime_audio").netCostKrw : totalsByKind.live_audio,
      ourEstimateKrw: totalsByKind.live_audio,
      gcpActualKrw: gcpConfigured ? actualTriplet("live_realtime_audio").grossCostKrw : null,
      note: "Gemini Live/Realtime audio SKU family 기준",
    },
    {
      key: "vercel",
      label: "Vercel(인프라)",
      category: "infra",
      usage: days,
      usageUnit: "days",
      grossKrw: vercelCost,
      creditKrw: 0,
      netKrw: vercelCost,
      monthEndProjectionKrw: projectToMonthEnd(vercelCost),
      estimateKrw: vercelCost,
      varianceKrw: 0,
      confirmedCostKrw: vercelCost,
      ourEstimateKrw: vercelCost,
      gcpActualKrw: null,
      note: "실제 청구서 연동 전 추정 고정비",
    },
    {
      key: "supabase",
      label: "Supabase(인프라)",
      category: "infra",
      usage: days,
      usageUnit: "days",
      grossKrw: supabaseCost,
      creditKrw: 0,
      netKrw: supabaseCost,
      monthEndProjectionKrw: projectToMonthEnd(supabaseCost),
      estimateKrw: supabaseCost,
      varianceKrw: 0,
      confirmedCostKrw: supabaseCost,
      ourEstimateKrw: supabaseCost,
      gcpActualKrw: null,
      note: "실제 청구서 연동 전 추정 고정비",
    },
    {
      key: "cloud_run",
      label: "Cloud Run(라이브 릴레이)",
      category: "infra",
      usage: days,
      usageUnit: "days",
      grossKrw: actualTriplet("cloud_run").grossCostKrw,
      creditKrw: actualTriplet("cloud_run").creditKrw,
      netKrw: actualTriplet("cloud_run").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("cloud_run").netCostKrw),
      estimateKrw: 0,
      varianceKrw: gcpConfigured ? actualTriplet("cloud_run").grossCostKrw - 0 : null,
      confirmedCostKrw: cloudRunActual,
      ourEstimateKrw: 0,
      gcpActualKrw: gcpConfigured ? actualTriplet("cloud_run").grossCostKrw : null,
      note: gcpConfigured ? "BigQuery 실청구(크레딧 반영)" : "BigQuery 미설정",
    },
    {
      key: "cloud_storage",
      label: "Cloud Storage",
      category: "infra",
      usage: days,
      usageUnit: "days",
      grossKrw: actualTriplet("cloud_storage").grossCostKrw,
      creditKrw: actualTriplet("cloud_storage").creditKrw,
      netKrw: actualTriplet("cloud_storage").netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet("cloud_storage").netCostKrw),
      estimateKrw: null,
      varianceKrw: null,
      confirmedCostKrw: gcpConfigured ? actualTriplet("cloud_storage").netCostKrw : 0,
      ourEstimateKrw: 0,
      gcpActualKrw: gcpConfigured ? actualTriplet("cloud_storage").grossCostKrw : null,
      note: gcpConfigured ? "BigQuery 실청구(크레딧 반영)" : "BigQuery 미설정",
    },
    ...(["cloud_logging", "bigquery", "artifact_registry", "secret_manager", "other"] as BillingCategory[]).map((key) => ({
      key,
      label: BILLING_CATEGORY_LABELS[key],
      category: "infra" as const,
      usage: 0,
      usageUnit: "mixed",
      grossKrw: actualTriplet(key).grossCostKrw,
      creditKrw: actualTriplet(key).creditKrw,
      netKrw: actualTriplet(key).netCostKrw,
      monthEndProjectionKrw: projectToMonthEnd(actualTriplet(key).netCostKrw),
      estimateKrw: null,
      varianceKrw: null,
      confirmedCostKrw: gcpConfigured ? actualTriplet(key).netCostKrw : 0,
      ourEstimateKrw: 0,
      gcpActualKrw: gcpConfigured ? actualTriplet(key).grossCostKrw : null,
      note: key === "other" ? "신규/알 수 없는 Service·SKU를 숨기지 않고 유지" : "BigQuery 실청구",
    })),
  ];
  const breakdownTotal = rawBreakdown.reduce((s, i) => s + i.confirmedCostKrw, 0);
  const costBreakdown = rawBreakdown
    .map((i) => ({ ...i, sharePct: breakdownTotal > 0 ? (i.confirmedCostKrw / breakdownTotal) * 100 : 0 }))
    .sort((a, b) => b.confirmedCostKrw - a.confirmedCostKrw);

  // ── Gemini 사용형태별(모델·입력 오디오·출력 오디오·텍스트 입력·텍스트 출력) SKU 실제 원가 매핑 ──
  // Gemini text와 Live/Realtime 카테고리의 SKU를 사용 형태 차원으로 함께 집계한다.
  // 입출력 차원으로 재집계한다(제품 단위 Live/LLM 임의 배분이 아니라 SKU 문자열 기준).
  const geminiDimensions: Record<GeminiUsageDimension, { grossKrw: number; creditKrw: number; netKrw: number }> = {
    input_audio: { grossKrw: 0, creditKrw: 0, netKrw: 0 },
    output_audio: { grossKrw: 0, creditKrw: 0, netKrw: 0 },
    text_input: { grossKrw: 0, creditKrw: 0, netKrw: 0 },
    text_output: { grossKrw: 0, creditKrw: 0, netKrw: 0 },
    other: { grossKrw: 0, creditKrw: 0, netKrw: 0 },
  };
  if (gcpConfigured) {
    for (const row of gcpBilling.skuRows) {
      if (row.category !== "vertex_ai_gemini" && row.category !== "live_realtime_audio") continue;
      const dim = row.geminiDimension ?? "other";
      geminiDimensions[dim].grossKrw += row.cost.grossCostKrw;
      geminiDimensions[dim].creditKrw += row.cost.creditKrw;
      geminiDimensions[dim].netKrw += row.cost.netCostKrw;
    }
  }

  // ── 실제 원가 정본(actualCost) — Google Cloud Billing 기준, 회사 전체(아이 단위 분해 불가) ──
  const actualCost = {
    configured: gcpConfigured,
    error: gcpBilling.error ?? null,
    dataCutoffDate: gcpBilling.dataCutoffDate,
    latestDataAt: gcpBilling.latestDataAt,
    latestDataAtKst: formatKstDateTime(gcpBilling.latestDataAt),
    projectScope: gcpBilling.projectScope,
    grossKrw: gcpBilling.total.grossCostKrw,
    creditKrw: gcpBilling.total.creditKrw,
    netKrw: gcpBilling.total.netCostKrw,
    byCategory: gcpBilling.totalsByCategory,
    skuRows: gcpBilling.skuRows,
    geminiUsageDimensions: geminiDimensions,
    unclassified: {
      count: gcpBilling.unclassified.count,
      services: gcpBilling.unclassified.services,
      grossKrw: gcpBilling.unclassified.cost.grossCostKrw,
      ratePct: gcpBilling.unclassified.ratePct,
      warning: gcpBilling.unclassified.ratePct > 1 || gcpBilling.unclassified.cost.grossCostKrw >= 100,
    },
  };

  // ── 내부 추정치(estimateCost) — usage_events 기반 "우리 추정", 실제 비용이 아님을 명시 ──
  const estimateCost = {
    stt: totalsByKind.stt,
    tts: totalsByKind.tts,
    live_audio: totalsByKind.live_audio,
    llm: totalsByKind.llm,
    embedding: totalsByKind.embedding,
    cloud_run: 0,
    totalKrw: aiCostTotal,
    note: "로컬 usage_events 기반 제품 단위 추정치 — 실제 청구액이 아님(actualCost 참고).",
  };

  // 내부 추정 정확도는 usage_events와 직접 비교 가능한 STT/TTS/Gemini text/Live만 사용한다.
  const comparableActualGross = gcpConfigured
    ? (["stt", "tts", "vertex_ai_gemini", "live_realtime_audio"] as BillingCategory[])
        .reduce((sum, category) => sum + gcpBilling.totalsByCategory[category].grossCostKrw, 0)
    : null;
  const comparableEstimate = totalsByKind.stt + totalsByKind.tts + totalsByKind.llm + totalsByKind.live_audio;
  const coveragePct = gcpConfigured && gcpBilling.total.grossCostKrw > 0 && comparableActualGross != null
    ? (comparableActualGross / gcpBilling.total.grossCostKrw) * 100
    : 0;
  const reconciliation = comparableActualGross == null
    ? null
    : {
        actualGrossKrw: comparableActualGross,
        estimateKrw: comparableEstimate,
        differenceKrw: comparableActualGross - comparableEstimate,
        underestimationRatePct: comparableActualGross > 0 ? ((comparableActualGross - comparableEstimate) / comparableActualGross) * 100 : 0,
        multiplier: comparableEstimate > 0 ? comparableActualGross / comparableEstimate : null,
        coveragePct,
        warning: coveragePct >= 50 && comparableActualGross > 0 && Math.abs(comparableActualGross - comparableEstimate) / comparableActualGross > 0.1,
      };

  // ── 회사 전체 원가(companyWideCost) — 고정비(Vercel+Supabase) + GCP 실제값 ──
  const fixedInfraKrw = vercelCost + supabaseCost;
  const companyWideCost = {
    fixedInfraKrw,
    totalIncurredKrw: fixedInfraKrw + (gcpConfigured ? gcpBilling.total.grossCostKrw : 0), // 크레딧 적용 전 총발생원가
    expectedCashOutlayKrw: fixedInfraKrw + (gcpConfigured ? gcpBilling.total.netCostKrw : 0), // 크레딧 적용 후 예상 현금지출
  };

  // ── 서비스별 TOP10 유저 — AI 4종 각각 사용량 기준 상위 10명(이름/사용량/비용) ──
  const topUsersByService: Record<string, { childId: string; name: string; usage: number; costKrw: number }[]> = {
    stt: [],
    tts: [],
    live_audio: [],
    llm: [],
  };
  for (const kind of Object.keys(topUsersByService)) {
    const rows = Array.from(usageByServiceChild.values())
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.costKrw - a.costKrw)
      .slice(0, 10)
      .map((r) => ({
        childId: r.childId,
        name: childById.get(r.childId)?.name ?? "(알 수 없음)",
        usage: r.usage,
        costKrw: r.costKrw,
      }));
    topUsersByService[kind] = rows;
  }

  // ── 아이별 수익성(드릴다운) — 항상 "전체 아이 목록", childId 필터 영향 없음.
  // 매출은 가입 요금제 기준(사용 여부 무관), 원가는 이번 기간 usage_events 합계.
  const perChild = children.map((child) => {
    const cost = costByChildAll.get(child.id) ?? 0;
    const tier = child.tier ?? 1;
    const plan = priceByTier.get(tier);
    const priceKrw = plan?.price ?? 0;
    const margin = priceKrw - cost;
    return {
      childId: child.id,
      name: child.name,
      tier,
      planName: plan?.name ?? `Tier ${tier}`,
      createdAt: child.created_at,
      priceKrw,
      costKrw: cost,
      marginKrw: margin,
      marginRate: priceKrw > 0 ? (margin / priceKrw) * 100 : 0,
    };
  }).sort((a, b) => a.marginKrw - b.marginKrw);

  const selectedChild = filterChildId ? childById.get(filterChildId) ?? null : null;

  return NextResponse.json({
    period,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      startDate: periodRange.startDate,
      endDate: periodRange.endDate,
      timezone: periodRange.timezone,
      fromKst: formatKstDateTime(from),
      toKst: formatKstDateTime(to),
    },
    environment: process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "Production" : "Development",
    billingBasis: "Google Cloud Billing Export",
    scope: filterChildId
      ? { mode: "child", childId: filterChildId, childName: selectedChild?.name ?? "(알 수 없음)", conversationMode: filterMode ?? (filterUnclassified ? UNCLASSIFIED_MODE : null) }
      : { mode: "all", conversationMode: filterMode ?? (filterUnclassified ? UNCLASSIFIED_MODE : null) },
    profitSummary: {
      revenueMode: REVENUE_MODE,
      isFreePeriod,
      // Plan01 §23 결정3: '실제'와 '예상'을 명확히 구분해 병기(혼합 금지).
      actual: {
        revenueKrw: actualRevenue,
        costKrw: actualTotalCost,
        netProfitKrw: actualNetProfit,
        costBasis: gcpBilling.configured && !filterChildId ? "bigquery_actual" : "estimate",
      },
      projected: {
        revenueKrw: projectedRevenue,
        costKrw: totalCost,
        netProfitKrw: netProfit,
        changeRate: {
          revenue: changeRate(projectedRevenue, prevRevenue),
          cost: changeRate(totalCost, prevTotalCost),
          profit: changeRate(netProfit, prevProfit),
        },
      },
      note: isFreePeriod
        ? "무료 제공 기간 — 실결제 없음(실매출 ₩0). '예상'은 가입 요금제 기준 가정 매출입니다."
        : "실결제 기준.",
      // 하위호환(기존 UI): 예상 기준 값 유지 — T4에서 실제/예상 라벨 UI로 대체 예정.
      projectedRevenueKrw: projectedRevenue,
      costKrw: totalCost,
      netProfitKrw: netProfit,
      changeRate: {
        revenue: changeRate(projectedRevenue, prevRevenue),
        cost: changeRate(totalCost, prevTotalCost),
        profit: changeRate(netProfit, prevProfit),
      },
    },
    fx: { usdToKrw: USD_TO_KRW, asOf: FX_AS_OF, note: "고정 환율(근사) — 실시간 FX는 후속." },
    modeBreakdown,
    subSummary: {
      totalChildren: children.length,
      byTier,
    },
    dailyTrend,
    costBreakdown,
    actualCost,
    estimateCost,
    internalUsage: {
      stt: { seconds: usageAmountByKind.sttSec, minutes: usageAmountByKind.sttSec / 60, eventCount: countsByKind.stt },
      tts: { characters: usageAmountByKind.ttsChars, eventCount: countsByKind.tts },
      llm: { inputTokens: usageAmountByKind.llmTokenIn, outputTokens: usageAmountByKind.llmTokenOut, eventCount: countsByKind.llm },
      liveAudio: { seconds: usageAmountByKind.liveSec, minutes: usageAmountByKind.liveSec / 60, eventCount: countsByKind.live_audio },
      embeddings: { requestCount: usageAmountByKind.embeddingRequests, inputCount: usageAmountByKind.embeddingInputs, eventCount: countsByKind.embedding },
    },
    reconciliation,
    companyWideCost,
    topUsersByService,
    traffic: {
      sessionCount: sessionCount ?? 0,
      sttCount: countsByKind.stt,
      ttsCount: countsByKind.tts,
      liveCount: countsByKind.live_audio,
      llmCount: countsByKind.llm,
      embeddingCount: countsByKind.embedding,
    },
    perChildProfitability: perChild,
    gcpBillingError: gcpBilling.error ?? null,
  });
}
