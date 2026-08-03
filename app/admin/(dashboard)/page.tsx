"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import FeedbackTab from "./FeedbackTab";
import ManualReportingTab from "./ManualReportingTab";
import PlanChangeRequestsTab from "./PlanChangeRequestsTab";
import EventsOverviewTab from "./EventsOverviewTab";
import MissionOnboardingEventsTab from "./MissionOnboardingEventsTab";
import QuizLeaderboardEventsTab from "./QuizLeaderboardEventsTab";
import RewardFulfillmentsTab from "./RewardFulfillmentsTab";
import { RetentionEmbed } from "@/components/admin/RetentionEmbed";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import { MODE_LABELS, ALL_MODE_BUCKETS, type ModeBucket } from "@/lib/plan/conversationMode";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminKpiCard } from "@/components/admin/shell/AdminKpiCard";
import { AdminEmptyState } from "@/components/admin/shell/AdminEmptyState";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
interface ChatMessageRow {
  session_id: string;
  role: "child" | "k";
  content: string;
  mode: string | null;
  voice_mode: string | null;
  created_at: string;
}

interface ConversationSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  session_type: string;
  turn_count: number;
  messages: ChatMessageRow[];
}

interface SafetyEvent {
  id: string;
  session_id: string;
  subcategory: string;
  child_text: string;
  created_at: string;
  viewed_at: string | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--admin-text-secondary)",
  borderBottom: "1px solid var(--admin-border)",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--admin-text-primary)",
  borderBottom: "1px solid var(--admin-border)",
  verticalAlign: "top",
};

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: "32px 0", textAlign: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>
      {text}
    </div>
  );
}

function ConversationsTab({ childId }: { childId: string }) {
  const [sessions, setSessions] = useState<ConversationSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    fetch(`/api/admin/conversations?childId=${childId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSessions(d.sessions ?? []); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [childId]);

  if (sessions === null) return <EmptyState text="불러오는 중..." />;
  if (sessions.length === 0) return <EmptyState text="대화 기록이 없어요." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sessions.map((s) => (
        <div
          key={s.id}
          style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: 16 }}
        >
          <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginBottom: 8 }}>
            {formatDateTime(s.started_at)} · {s.session_type === "mission" ? "미션" : "자유대화"} · {s.turn_count}턴
            {!s.ended_at && " · 진행중"}
          </div>
          {s.messages.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--admin-text-secondary)" }}>메시지 없음</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.messages.map((m, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: m.role === "k" ? "var(--admin-primary)" : "var(--admin-text-primary)" }}>
                    {m.role === "k" ? "케이" : "아이"}
                  </span>
                  <span style={{ color: "var(--admin-text-primary)" }}>: {m.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type Period = "today" | "7d" | "month";

const PERIOD_LABEL: Record<Period, string> = { today: "오늘", "7d": "최근 7일", month: "이번 달" };

interface DailyTrendPoint {
  day: string;
  revenueKrw: number;
  costKrw: number;
}

interface PerChildProfitability {
  childId: string;
  name: string;
  tier: number;
  planName: string;
  createdAt: string;
  priceKrw: number;
  costKrw: number;
  marginKrw: number;
  marginRate: number;
}

interface TierHeadcount {
  tier: number;
  name: string;
  priceKrw: number;
  count: number;
}

interface CostBreakdownItem {
  key: "stt" | "tts" | "gemini_agent_platform" | "agent_platform_model_garden" | "cloud_run" | "cloud_storage" | "vercel" | "supabase";
  label: string;
  category: "ai" | "infra";
  usage: number;
  usageUnit: "sec" | "chars" | "tokens" | "days";
  ourEstimateKrw: number;
  gcpActualKrw: number | null;
  confirmedCostKrw: number;
  sharePct: number;
  grossKrw: number;
  creditKrw: number;
  netKrw: number;
  monthEndProjectionKrw: number;
  estimateKrw: number | null;
  varianceKrw: number | null;
  note?: string;
}

interface TopUser {
  childId: string;
  name: string;
  usage: number;
  costKrw: number;
}

interface ProfitLine {
  revenueKrw: number;
  costKrw: number;
  netProfitKrw: number;
}

interface ModeBreakdownRow {
  mode: ModeBucket;
  eventCount: number;
  stt: number;
  tts: number;
  live_audio: number;
  llm: number;
  totalKrw: number;
}

interface UsageOverview {
  period: Period;
  scope:
    | { mode: "all"; conversationMode: ModeBucket | null }
    | { mode: "child"; childId: string; childName: string; conversationMode: ModeBucket | null };
  profitSummary: {
    revenueMode: string;
    isFreePeriod: boolean;
    actual: ProfitLine & { costBasis: string };
    projected: ProfitLine & { changeRate: { revenue: number | null; cost: number | null; profit: number | null } };
    note: string;
    // 하위호환(기존 UI 유지)
    projectedRevenueKrw: number;
    costKrw: number;
    netProfitKrw: number;
    changeRate: { revenue: number | null; cost: number | null; profit: number | null };
  };
  fx: { usdToKrw: number; asOf: string; note: string };
  modeBreakdown: ModeBreakdownRow[];
  subSummary: { totalChildren: number; byTier: TierHeadcount[] };
  dailyTrend: DailyTrendPoint[];
  costBreakdown: CostBreakdownItem[];
  topUsersByService: Record<string, TopUser[]>;
  traffic: { sessionCount: number; sttCount: number; ttsCount: number; liveCount: number; llmCount: number };
  perChildProfitability: PerChildProfitability[];
  gcpBillingError: string | null;

  actualCost: {
    configured: boolean;
    error: string | null;
    dataCutoffDate: string;
    grossKrw: number;
    creditKrw: number;
    netKrw: number;
    byCategory: Record<"stt"|"tts"|"gemini_agent_platform"|"agent_platform_model_garden"|"cloud_run"|"cloud_storage"|"other", { grossCostKrw: number; creditKrw: number; netCostKrw: number }>;
    geminiUsageDimensions: Record<"input_audio"|"output_audio"|"text_input"|"text_output"|"other", { grossKrw: number; creditKrw: number; netKrw: number }>;
    unclassified: { count: number; services: string[]; grossKrw: number; ratePct: number; warning: boolean };
  };
  estimateCost: {
    stt: number; tts: number; live_audio: number; llm: number; cloud_run: number;
    totalKrw: number;
    note: string;
  };
  reconciliation: null | {
    actualGrossKrw: number;
    estimateKrw: number;
    differenceKrw: number;
    underestimationRatePct: number;
    multiplier: number | null;
    warning: boolean;
  };
  companyWideCost: {
    fixedInfraKrw: number;
    totalIncurredKrw: number;
    expectedCashOutlayKrw: number;
  };
}

function usageLabel(usage: number, unit: CostBreakdownItem["usageUnit"]): string {
  switch (unit) {
    case "sec":
      return `${(usage / 60).toFixed(1)}분`;
    case "chars":
      return `${usage.toLocaleString("ko-KR")}자`;
    case "tokens":
      return `${usage.toLocaleString("ko-KR")}토큰`;
    case "days":
      return `${usage}일`;
    default:
      return String(usage);
  }
}

function formatChangeRate(rate: number | null): { text: string; color: string } {
  if (rate == null) return { text: "직전 기간 데이터 없음", color: "var(--admin-text-secondary)" };
  const sign = rate > 0 ? "+" : "";
  const color = rate >= 0 ? "var(--admin-success)" : "var(--admin-danger)";
  return { text: `${sign}${rate.toFixed(1)}% (전기 대비)`, color };
}

function won(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function BigNumberCard({
  label,
  value,
  color,
  sub,
  changeRate,
  onClick,
  active,
  borderColor,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  changeRate?: number | null;
  onClick?: () => void;
  active?: boolean;
  borderColor?: string;
}) {
  const change = changeRate !== undefined ? formatChangeRate(changeRate) : null;
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--admin-surface)",
        borderRadius: 14,
        
        padding: "18px 22px",
        minWidth: 0,
        cursor: onClick ? "pointer" : undefined,
        border: borderColor ? `2px solid ${borderColor}` : active ? "2px solid var(--admin-primary)" : "2px solid transparent",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--admin-text-secondary)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        {onClick && <span style={{ color: "var(--admin-primary)", fontWeight: 700 }}>{active ? "▲ 상세 닫기" : "▼ 클릭해서 자세히"}</span>}
      </div>
      <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800, color: color ?? "var(--admin-text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginTop: 4 }}>{sub}</div>}
      {change && <div style={{ fontSize: 12, color: change.color, marginTop: 4, fontWeight: 600 }}>{change.text}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text-primary)", margin: "24px 0 10px" }}>{children}</div>;
}

// TOP10 유저 드릴다운이 있는 서비스 — costBreakdown 항목 중 이 키들만 클릭 가능(인프라 고정비는 제외).
const topUsersByServiceKeys = ["stt", "tts"];

// 인라인 아코디언 펼침 공용 래퍼 — table row 아래(colSpan)에 넣어서 부드럽게 나타나게 한다.
// 스크롤 폭주 방지 규칙은 호출부에서 "같은 레벨엔 단일 선택 state"로 강제한다(새로 열면 이전 건 자동 접힘).
function AccordionExpand({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--admin-focus)",
        borderRadius: 12,
        margin: "0 0 12px",
        animation: "hbAccordionIn 0.18s ease",
      }}
    >
      {children}
      <style jsx>{`
        @keyframes hbAccordionIn {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

type ChildDetailSubTab = "usage" | "conversations" | "safety";

const CHILD_DETAIL_SUB_TABS: { id: ChildDetailSubTab; label: string }[] = [
  { id: "usage", label: "사용량" },
  { id: "conversations", label: "대화 내역" },
  { id: "safety", label: "안전 이벤트" },
];

function ChildUsageDetail({ period, childId }: { period: Period; childId: string }) {
  const [detail, setDetail] = useState<UsageOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    fetch(`/api/admin/usage-overview?period=${period}&childId=${childId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [period, childId]);

  if (failed) return <EmptyState text="상세 데이터를 불러오지 못했어요." />;
  if (!detail) return <EmptyState text="불러오는 중..." />;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ background: "var(--admin-surface)", borderRadius: 10, padding: "10px 14px", fontSize: 12, minWidth: 100 }}>
          <div style={{ color: "var(--admin-text-secondary)" }}>대화 세션 수</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text-primary)" }}>{detail.traffic.sessionCount}건</div>
        </div>
      </div>
      <div style={{ overflowX: "auto", background: "var(--admin-surface)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>서비스</th>
              <th style={thStyle}>사용량</th>
              <th style={thStyle}>원가</th>
            </tr>
          </thead>
          <tbody>
            {detail.costBreakdown.filter((i) => i.category === "ai").map((i) => (
              <tr key={i.key}>
                <td style={tdStyle}>{i.label}</td>
                <td style={tdStyle}>{usageLabel(i.usage, i.usageUnit)}</td>
                <td style={tdStyle}>{won(i.ourEstimateKrw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, background: "var(--admin-surface)", borderRadius: 12, padding: 12, height: 180 }}>
        {detail.dailyTrend.length === 0 ? (
          <EmptyState text="기간 내 원가 추이가 없어요." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={detail.dailyTrend.map((d) => ({ day: d.day, 원가: Math.round(d.costKrw) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" />
              <XAxis dataKey="day" fontSize={11} />
              <YAxis fontSize={11} width={60} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => won(typeof v === "number" ? v : Number(v))} />
              <Line type="monotone" dataKey="원가" stroke="#9b6bd6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ChildDetailPanel({ period, childId, childName }: { period: Period; childId: string; childName: string }) {
  const [subTab, setSubTab] = useState<ChildDetailSubTab>("usage");

  return (
    <div style={{ padding: 16, background: "var(--admin-focus)", borderRadius: 12, marginTop: -4, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--admin-primary)", marginBottom: 10 }}>
        {childName} 상세 ({PERIOD_LABEL[period]})
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {CHILD_DETAIL_SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: subTab === t.id ? 700 : 400,
              border: subTab === t.id ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
              background: subTab === t.id ? "var(--admin-surface)" : "transparent",
              color: subTab === t.id ? "var(--admin-primary)" : "var(--admin-text-secondary)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "usage" && <ChildUsageDetail period={period} childId={childId} />}
      {subTab === "conversations" && <ConversationsTab childId={childId} />}
      {subTab === "safety" && <SafetyTab childId={childId} />}
    </div>
  );
}

// 유저 상세 우측 슬라이드 패널 — 비용 탭/매출 탭 공통 진입점(selectedChildUser)이 이걸 연다.
// 상위 아코디언(TOP10/티어 목록)과는 완전히 분리된 페이지 최상위 오버레이 1곳에서만 렌더된다.
function ChildRightPanel({
  selected,
  onClose,
}: {
  selected: { childId: string; childName: string; period: Period } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, onClose]);

  if (!selected) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.32)" }} />
      <div
        style={{
          position: "relative",
          width: "min(440px, 92vw)",
          height: "100%",
          background: "var(--admin-bg)",
          boxShadow: "-6px 0 24px rgba(0,0,0,0.18)",
          overflowY: "auto",
          padding: 20,
          animation: "hbRightPanelSlideIn 0.18s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              color: "var(--admin-text-secondary)",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        <ChildDetailPanel period={selected.period} childId={selected.childId} childName={selected.childName} />
        <style jsx>{`
          @keyframes hbRightPanelSlideIn {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
        `}</style>
      </div>
    </div>
  );
}

// AdminPageId and ADMIN_NAV_ITEMS are imported from AdminShell

function LlmStatusTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/llm-status")
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) return <EmptyState text="데이터를 불러오지 못했습니다." />;
  if (!data) return <EmptyState text="불러오는 중..." />;

  const { summary, entries } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <SectionTitle>LLM 사용 현황 요약</SectionTitle>
        <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "var(--admin-text-sm)", color: "var(--admin-text-primary)" }}>
            <div><strong>환경:</strong> {summary.environment}</div>
            <div><strong>배포 커밋:</strong> {summary.commitSha.substring(0, 7)}</div>
            <div><strong>마지막 빌드:</strong> {summary.buildTime}</div>
            <div><strong>마지막 확인:</strong> {formatDateTime(summary.lastCheckTime)}</div>
            <div><strong>등록 기능 수:</strong> {summary.total}개</div>
            <div><strong>정상:</strong> <span style={{ color: "var(--admin-success)" }}>{summary.normal}개</span></div>
            <div><strong>미설정:</strong> <span style={{ color: "var(--admin-danger)" }}>{summary.missing}개</span></div>
            <div><strong>설정 불일치:</strong> <span style={{ color: "var(--admin-danger)" }}>{summary.mismatch}개</span></div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>기능별 모델 적용 현황</SectionTitle>
        <AdminDataTable
          columns={[
            { key: "name", header: "기능명 (유형/플랫폼)", render: (r: any) => (
              <>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 2 }}>{r.featureType} · {r.platform}</div>
              </>
            )},
            { key: "model", header: "실제 적용 모델", render: (r: any) => (
              <>
                <span style={{ fontWeight: 600, color: "var(--admin-focus)" }}>{r.effectiveModel}</span>
                {r.apiMethod && <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 2 }}>{r.apiMethod}</div>}
              </>
            )},
            { key: "default", header: "기본값 / 환경변수", render: (r: any) => (
              <>
                <div style={{ fontSize: "var(--admin-text-sm)" }}>{r.defaultModel}</div>
                {r.envKey && <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 2 }}>{r.envKey}</div>}
              </>
            )},
            { key: "path", header: "호출부 / 리전", render: (r: any) => (
              <>
                <div style={{ fontSize: "var(--admin-text-sm)" }}>{r.internalPath}</div>
                <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 2 }}>{r.region}</div>
              </>
            )},
            { key: "status", header: "상태", render: (r: any) => (
              <>
                <AdminStatusBadge
                  text={r.status}
                  variant={
                    r.status === "정상" || r.status === "기본값 사용" ? "success" :
                    r.status === "확인 불가" ? "neutral" :
                    "danger"
                  }
                />
                {r.warningReason && <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-danger)", marginTop: 2 }}>{r.warningReason}</div>}
              </>
            )}
          ]}
          data={entries}
          keyExtractor={(r: any) => r.id}
        />
      </div>
    </div>
  );
}

interface GcaiProfileRow {
  profile: "A" | "B";
  google_cloud_project: string | null;
  is_active: boolean;
  last_health_check_result: any;
}

function GCAIProfileSection() {
  const [profiles, setProfiles] = useState<GcaiProfileRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [healthChecking, setHealthChecking] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setProfiles(null);
    setLoadFailed(false);
    fetch("/api/admin/gcai-profiles")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setLoadFailed(true);
        else setProfiles(d.profiles);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const runHealthCheck = async (profile: "A" | "B") => {
    setHealthChecking(profile);
    setErrorMsg(null);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/gcai-health?profile=${profile}`);
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "헬스체크 실패");
      }

      setProfiles((prev) => prev?.map(p => {
        if (p.profile === profile) {
          if (data.status === '미설정') {
            return { ...p, last_health_check_result: { _status: "미설정" } };
          } else if (data.checks) {
            return { ...p, last_health_check_result: data.checks };
          }
        }
        return p;
      }) || null);
    } catch {
      setErrorMsg("헬스체크 요청 실패");
    } finally {
      setHealthChecking(null);
    }
  };

  const handleSwitch = async (targetProfile: "A" | "B") => {
    if (!window.confirm(`정말 프로필 ${targetProfile}로 전환하시겠습니까?\\nDB 표시값만 바뀌며 실제 적용은 Vercel 환경변수 변경+재배포가 필요합니다.`)) {
      return;
    }

    setSwitching(targetProfile);
    setErrorMsg(null);
    setActionMsg(null);
    try {
      const res = await fetch("/api/admin/gcai-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProfile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "전환 실패");
      } else {
        setActionMsg(data.message);
      }
      load();
    } catch {
      setErrorMsg("전환 요청 실패");
    } finally {
      setSwitching(null);
    }
  };

  if (loadFailed) return <EmptyState text="GCAI 프로필 정보를 불러오지 못했어요." />;
  if (!profiles) return <EmptyState text="불러오는 중..." />;

  const maskProject = (proj: string | null) => {
    if (!proj) return "미설정";
    if (proj.length <= 4) return proj;
    return proj.substring(0, 4) + "*".repeat(proj.length - 4);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <SectionTitle>GCAI A/B 프로필 설정</SectionTitle>
      {errorMsg && <div style={{ fontSize: 12, color: "var(--admin-danger)", marginBottom: 10 }}>{errorMsg}</div>}
      {actionMsg && <div style={{ fontSize: 12, color: "var(--admin-primary)", marginBottom: 10, background: "var(--admin-focus)", padding: "8px 12px", borderRadius: 8 }}>{actionMsg}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {profiles.map(p => {
          const isUnconfigured = !p.last_health_check_result || Object.keys(p.last_health_check_result).length === 0 || p.last_health_check_result._status === "미설정";
          let allPassed = false;
          if (p.last_health_check_result && !isUnconfigured) {
            const checks = p.last_health_check_result;
            const requiredKeys = ["groupA", "groupB", "groupC", "stt", "tts"];
            allPassed = requiredKeys.every(k => checks[k] && checks[k].status === "ok");
          }

          return (
            <div key={p.profile} style={{ background: "var(--admin-surface)", borderRadius: 12, padding: 16, border: p.is_active ? "2px solid var(--admin-primary)" : "1px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                    프로필 {p.profile}
                    {p.is_active && <span style={{ fontSize: 11, background: "var(--admin-primary)", color: "white", padding: "2px 6px", borderRadius: 4 }}>활성</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginTop: 4 }}>
                    Project: {maskProject(p.google_cloud_project)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => runHealthCheck(p.profile)}
                    disabled={healthChecking === p.profile}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid var(--admin-border)",
                      background: "white", color: "var(--admin-text-primary)", fontSize: 12, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    {healthChecking === p.profile ? "실행 중..." : "헬스체크 실행"}
                  </button>
                  <button
                    onClick={() => handleSwitch(p.profile)}
                    disabled={!allPassed || switching === p.profile}
                    title={!allPassed ? (isUnconfigured ? `${p.profile} 자격증명 미설정` : "헬스체크가 모두 성공해야 전환 가능합니다.") : undefined}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none",
                      background: (!allPassed || switching === p.profile) ? "var(--admin-border)" : "var(--admin-primary)",
                      color: (!allPassed || switching === p.profile) ? "var(--admin-text-secondary)" : "white",
                      fontSize: 12, fontWeight: 700, cursor: (!allPassed || switching === p.profile) ? "not-allowed" : "pointer"
                    }}
                  >
                    {switching === p.profile ? "전환 중..." : "이 프로필로 전환"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexDirection: "column", marginTop: 12 }}>
                {["groupA", "groupB", "groupC", "stt", "tts"].map(svc => {
                  const check = p.last_health_check_result?.[svc];
                  let color = "var(--admin-text-secondary)";
                  let bg = "white";
                  let label = svc === "groupA" ? "TEXT A" : svc === "groupB" ? "TEXT B" : svc === "groupC" ? "LIVE C" : svc.toUpperCase();
                  if (check) {
                    if (check.status === "ok") {
                      color = "var(--admin-success)";
                      bg = "var(--admin-surface)";
                    } else if (check.status === "fail") {
                      color = "var(--admin-danger)";
                      bg = "var(--admin-surface)";
                    }
                  }
                  return (
                    <div key={svc} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, background: bg, border: `1px solid ${color}`, color, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      {check ? (
                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                          <div>
                            <span style={{ fontWeight: 700 }}>{check.status === "ok" ? "OK" : "FAIL"}</span>
                            {check.ms !== undefined && <span style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginLeft: 6 }}>{check.ms}ms</span>}
                          </div>
                          {check.modelVersion && <div style={{ fontSize: 10, color: "var(--admin-text-secondary)" }}>{check.modelVersion}</div>}
                          {check.status === "fail" && check.detail && <div style={{ fontSize: 11, color: "var(--admin-danger)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={check.detail}>{check.detail}</div>}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11 }}>미확인</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BetaApplicationsTab() {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  // Custom Modal states
  const [rejectModalUserId, setRejectModalUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveModalUserId, setApproveModalUserId] = useState<string | null>(null);
  const [approveSelectedTier, setApproveSelectedTier] = useState<number>(2);
  const [resultToast, setResultToast] = useState<{ type: "success" | "error"; text: string } | null>(null);


  useEffect(() => {
    if (!resultToast) return;
    const t = setTimeout(() => setResultToast(null), 3000);
    return () => clearTimeout(t);
  }, [resultToast]);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/beta-applications")
      .then(r => r.json())
      .then(d => {
        setRequests(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const execAction = async (userId: string, action: "approve" | "reject", payload: any) => {
    setActionLoading(userId);
    try {
      const url = `/api/admin/beta-applications/${userId}/${action}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setResultToast({ type: "success", text: "처리되었습니다." });
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        setResultToast({ type: "error", text: d.error || "처리 실패" });
      }
    } catch (err) {
      setResultToast({ type: "error", text: "오류 발생" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveConfirm = () => {
    if (!approveModalUserId) return;
    execAction(approveModalUserId, "approve", { tier: approveSelectedTier });
    setApproveModalUserId(null);
  };

  const handleRejectConfirm = () => {
    if (!rejectModalUserId) return;
    execAction(rejectModalUserId, "reject", { reason: rejectReason });
    setRejectModalUserId(null);
    setRejectReason("");
  };

  const toast = resultToast && (
    <div
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 100,
        padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
        background: resultToast.type === "success" ? "var(--admin-primary)" : "var(--admin-danger)",
        color: "white", border: "1px solid var(--admin-border)",
      }}
    >
      {resultToast.text}
    </div>
  );

  // Handle empty state gracefully by DataTable.
  // We can just keep the toast rendered.

  const columns: AdminDataTableColumn<any>[] = [
    {
      key: "name",
      header: "이름",
      render: (req) => <div style={{ fontWeight: 600 }}>{req.name || "정보 미입력"}</div>,
    },
    {
      key: "created_at",
      header: "신청일",
      render: (req) => {
        if (!req.created_at || req.created_at.startsWith("1970-01-01")) return <span style={{ color: "var(--admin-text-secondary)" }}>신청일 미확인</span>;
        return formatDateTime(req.created_at);
      },
    },
    {
      key: "phone",
      header: "연락처",
      render: (req) => req.phone || <span style={{ color: "var(--admin-text-secondary)" }}>정보 미입력</span>,
    },
    {
      key: "age_group",
      header: "연령대",
      render: (req) => req.age_group || <span style={{ color: "var(--admin-text-secondary)" }}>정보 미입력</span>,
    },
    {
      key: "referral_source",
      header: "유입 경로",
      render: (req) => (
        <div>
          <div>{req.referral_source || <span style={{ color: "var(--admin-text-secondary)" }}>정보 미입력</span>}</div>
          {req.motivation && <div style={{ fontSize: "12px", color: "var(--admin-text-secondary)", marginTop: "4px" }}>동기: {req.motivation}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (req) => <AdminStatusBadge variant="warning" text="대기 중" />,
    },
    {
      key: "actions",
      header: "액션",
      render: (req) => (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setRejectModalUserId(req.user_id); setRejectReason(""); }}
            disabled={actionLoading === req.user_id}
            style={{
              padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--admin-danger)",
              background: "white", color: "var(--admin-danger)", fontSize: "12px", fontWeight: 700, cursor: "pointer"
            }}
          >
            거절
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setApproveModalUserId(req.user_id); setApproveSelectedTier(2); }}
            disabled={actionLoading === req.user_id}
            style={{
              padding: "6px 12px", borderRadius: "8px", border: "none",
              background: "var(--admin-primary)", color: "white", fontSize: "12px", fontWeight: 700, cursor: "pointer"
            }}
          >
            승인
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {toast}
      <AdminPageHeader title="베타 신청 관리" description="가입을 대기 중인 베타 신청자 목록입니다." />
      <AdminDataTable
        columns={columns}
        data={requests || []}
        keyExtractor={(req) => req.user_id}
        isLoading={loading}
        emptyMessage="베타 신청 내역이 없습니다."
      />

      {approveModalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" aria-modal="true" role="dialog">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-[var(--admin-primary)] mb-4">플랜 승인</h3>
            <p className="text-sm text-gray-600 mb-4">승인할 플랜을 선택하세요.</p>
            <div className="flex flex-col gap-2 mb-6">
              {[
                { tier: 1, label: "Care Start" },
                { tier: 2, label: "Care Insight (기본)" },
                { tier: 3, label: "Care Premium", disabled: true } // 053: 모든 환경에서 차단
              ].map(plan => (
                <label key={plan.tier} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${approveSelectedTier === plan.tier ? 'border-[var(--admin-primary)] bg-blue-50' : 'border-gray-200 hover:bg-gray-50'} ${plan.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input
                    type="radio"
                    name="approvePlanTier"
                    value={plan.tier}
                    checked={approveSelectedTier === plan.tier}
                    onChange={() => setApproveSelectedTier(plan.tier)}
                    disabled={plan.disabled}
                    className="w-4 h-4 text-[var(--admin-primary)]"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-[15px]">{plan.label}</div>
                    {plan.disabled && <div className="text-xs text-gray-500 mt-1">준비 중</div>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setApproveModalUserId(null)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl"
              >
                취소
              </button>
              <button
                onClick={handleApproveConfirm}
                className="flex-1 py-3 bg-[var(--admin-primary)] text-white font-bold rounded-xl"
              >
                승인
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" aria-modal="true" role="dialog">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-[var(--admin-primary)] mb-4">가입 거절</h3>
            <p className="text-sm text-gray-600 mb-4">거절 사유를 입력하세요 (선택)</p>
            <textarea
              className="w-full p-3 border border-gray-200 rounded-xl mb-6 h-24 resize-none focus:outline-none focus:border-[var(--admin-primary)]"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="사유 입력..."
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setRejectModalUserId(null);
                  setRejectReason("");
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl"
              >
                취소
              </button>
              <button
                onClick={handleRejectConfirm}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl"
              >
                거절
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChildApprovalRequestsTab() {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, { beta: boolean; survey: boolean }>>({});
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");

  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [resultToast, setResultToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!resultToast) return;
    const t = setTimeout(() => setResultToast(null), 3000);
    return () => clearTimeout(t);
  }, [resultToast]);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/child-approval-requests")
      .then(r => r.json())
      .then(d => {
        const rows = Array.isArray(d) ? d : [];
        setRequests(rows);
        setVerifications((current) => {
          const next = { ...current };
          for (const row of rows) {
            if (!next[row.id]) {
              next[row.id] = {
                beta: row.beta_verified === true,
                survey: row.survey_verified === true,
              };
            }
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    const verification = verifications[id];
    if (!verification?.beta || !verification?.survey) {
      setResultToast({ type: "error", text: "베타 신청과 설문 완료를 모두 확인해주세요." });
      return;
    }
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/child-approval-requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betaVerified: true, surveyVerified: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResultToast({ type: "success", text: "승인 처리되었습니다. 아이 계정이 생성됐어요." });
      } else {
        setResultToast({ type: "error", text: data.error || "승인 처리에 실패했습니다." });
      }
      load();
    } catch {
      setResultToast({ type: "error", text: "오류 발생" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectModalId) return;
    const id = rejectModalId;
    setRejectModalId(null);
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/child-approval-requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) {
        setResultToast({ type: "success", text: "거절 처리되었습니다." });
      } else {
        const data = await res.json().catch(() => ({}));
        setResultToast({ type: "error", text: data.error || "처리 실패" });
      }
      load();
    } catch {
      setResultToast({ type: "error", text: "오류 발생" });
    } finally {
      setActionLoading(null);
      setRejectReason("");
    }
  };

  const toast = resultToast && (
    <div
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 100,
        padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
        background: resultToast.type === "success" ? "var(--admin-primary)" : "var(--admin-danger)",
        color: "white", border: "1px solid var(--admin-border)",
      }}
    >
      {resultToast.text}
    </div>
  );

  // Handle empty state gracefully by DataTable.

  const STATUS_LABEL: Record<string, string> = {
    pending: "승인 대기",
    creation_failed: "프로필 생성 실패",
    rejected: "거절됨",
    approved: "승인 완료",
  };

  const filteredRequests = (requests || []).filter((req: any) => {
    if (activeTab === "pending") return req.status === "pending" || req.status === "creation_failed";
    return req.status === "approved" || req.status === "rejected";
  });

  const columns: AdminDataTableColumn<any>[] = [
    {
      key: "child",
      header: "아이",
      render: (req) => <div style={{ fontWeight: 600 }}>{req.family_name}{req.given_name}</div>,
    },
    {
      key: "grade",
      header: "학년",
      render: (req) => req.grade,
    },
    {
      key: "requested_at",
      header: "요청일",
      render: (req) => formatDateTime(req.requested_at),
    },
    {
      key: "requester",
      header: "요청자",
      render: (req) => req.requester_email,
    },
    {
      key: "family_creator",
      header: "가족 생성자",
      render: (req) => req.family_creator_email,
    },
    {
      key: "interests",
      header: "관심사",
      render: (req) => {
        const list = req.interests || [];
        if (list.length === 0) return <span style={{ color: "var(--admin-text-secondary)" }}>없음</span>;
        if (list.length <= 3) return list.map((i: string) => `[${i}]`).join(" ");
        return `${list.slice(0, 3).map((i: string) => `[${i}]`).join(" ")} +${list.length - 3}`;
      },
    },
    {
      key: "status",
      header: "상태",
      render: (req) => {
        const isActionable = req.status === "pending" || req.status === "creation_failed";
        const verification = verifications[req.id] ?? { beta: req.beta_verified === true, survey: req.survey_verified === true };
        const verificationComplete = verification.beta && verification.survey;
        
        let statusBadge;
        if (req.status === "pending") statusBadge = <AdminStatusBadge variant="warning" text={STATUS_LABEL[req.status]} />;
        else if (req.status === "creation_failed") statusBadge = <AdminStatusBadge variant="danger" text={STATUS_LABEL[req.status]} />;
        else if (req.status === "rejected") statusBadge = <AdminStatusBadge variant="neutral" text={STATUS_LABEL[req.status]} />;
        else if (req.status === "approved") statusBadge = <AdminStatusBadge variant="success" text={STATUS_LABEL[req.status]} />;

        if (!isActionable) {
          return (
            <div>
              {statusBadge}
              {req.status === "rejected" && req.rejected_reason && <div style={{ fontSize: "11px", color: "var(--admin-text-secondary)", marginTop: "4px" }}>사유: {req.rejected_reason}</div>}
            </div>
          );
        }

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>{statusBadge}</div>
            {req.status === "creation_failed" && req.failure_reason && (
              <div style={{ fontSize: "11px", color: "var(--admin-danger)", marginTop: "4px" }}>{req.failure_reason}</div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--admin-text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={verification.beta}
                onChange={(event) =>
                  setVerifications((current) => ({
                    ...current,
                    [req.id]: { ...verification, beta: event.target.checked },
                  }))
                }
              />
              베타 신청 확인
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--admin-text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={verification.survey}
                onChange={(event) =>
                  setVerifications((current) => ({
                    ...current,
                    [req.id]: { ...verification, survey: event.target.checked },
                  }))
                }
              />
              설문 완료 확인
            </label>
          </div>
        );
      },
    },
  ];

  if (activeTab === "pending") {
    columns.push({
      key: "actions",
      header: "액션",
      render: (req) => {
        const verification = verifications[req.id] ?? { beta: req.beta_verified === true, survey: req.survey_verified === true };
        const verificationComplete = verification.beta && verification.survey;

        return (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setRejectModalId(req.id); setRejectReason(""); }}
              disabled={actionLoading === req.id}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid var(--admin-danger)",
                background: "white", color: "var(--admin-danger)", fontSize: 12, fontWeight: 700, cursor: "pointer"
              }}
            >
              거절
            </button>
            <button
              onClick={() => handleApprove(req.id)}
              disabled={actionLoading === req.id || !verificationComplete}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "none",
                background: "var(--admin-primary)", color: "white", fontSize: 12, fontWeight: 700,
                cursor: verificationComplete ? "pointer" : "not-allowed",
                opacity: verificationComplete ? 1 : 0.45,
              }}
            >
              {req.status === "creation_failed" ? (actionLoading === req.id ? "재시도 중..." : "재시도") : (actionLoading === req.id ? "승인 중..." : "승인")}
            </button>
          </div>
        );
      }
    });
  }

  return (
    <div>
      {toast}
      <AdminPageHeader title="아이 승인 요청 관리" description="가족 생성자가 아이 추가를 요청한 내역입니다." />
      
      <AdminFilterBar
        filterNodes={[
          <button
            key="pending"
            onClick={() => setActiveTab("pending")}
            style={{
              padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: "8px", border: activeTab === "pending" ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
              background: activeTab === "pending" ? "var(--admin-focus)" : "var(--admin-surface)",
              color: activeTab === "pending" ? "var(--admin-primary)" : "var(--admin-text-secondary)",
              fontSize: "13px", fontWeight: activeTab === "pending" ? 700 : 400, cursor: "pointer"
            }}
          >
            대기 중인 요청
          </button>,
          <button
            key="completed"
            onClick={() => setActiveTab("completed")}
            style={{
              padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: "8px", border: activeTab === "completed" ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
              background: activeTab === "completed" ? "var(--admin-focus)" : "var(--admin-surface)",
              color: activeTab === "completed" ? "var(--admin-primary)" : "var(--admin-text-secondary)",
              fontSize: "13px", fontWeight: activeTab === "completed" ? 700 : 400, cursor: "pointer"
            }}
          >
            처리 완료
          </button>
        ]}
      />

      <AdminDataTable
        columns={columns}
        data={filteredRequests}
        keyExtractor={(req) => req.id}
        isLoading={loading}
        emptyMessage="해당 상태의 아이 승인 요청이 없습니다."
        density="comfortable"
      />

      {rejectModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" aria-modal="true" role="dialog">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-[var(--admin-primary)] mb-4">아이 승인 거절</h3>
            <p className="text-sm text-gray-600 mb-4">거절 사유를 입력하세요 (선택)</p>
            <textarea
              className="w-full p-3 border border-gray-200 rounded-xl mb-6 h-24 resize-none focus:outline-none focus:border-[var(--admin-primary)]"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="사유 입력..."
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectModalId(null); setRejectReason(""); }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl"
              >
                취소
              </button>
              <button
                onClick={handleRejectConfirm}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl"
              >
                거절
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRestoreTab() {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/account-restore-requests")
      .then(r => r.json())
      .then(d => {
        setRequests(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    let reason = "";
    if (action === "reject") {
      const input = window.prompt("거절 사유를 입력하세요 (선택):");
      if (input === null) return;
      reason = input;
    }

    if (action === "approve" && !window.confirm("계정 복구를 승인하시겠습니까?")) return;

    setActionLoading(id);
    try {
      const url = `/api/admin/account-restore-requests/${id}/${action}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {})
      });
      if (res.ok) {
        alert("처리되었습니다.");
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "처리 실패");
      }
    } catch (err) {
      alert("오류 발생");
    } finally {
      setActionLoading(null);
    }
  };

  const columns: AdminDataTableColumn<any>[] = [
    { key: "name", header: "이름", render: (r) => <div style={{ fontWeight: 600 }}>{r.name}</div> },
    { key: "email", header: "이메일", render: (r) => r.email },
    { key: "withdrawn", header: "탈퇴일", render: (r) => formatDateTime(r.withdrawn_at) },
    { key: "purge", header: "삭제예정일", render: (r) => formatDateTime(r.purge_scheduled_at) },
    { key: "requested", header: "신청일", render: (r) => formatDateTime(r.restore_requested_at) },
    { key: "family", header: "가족", render: (r) => r.memberships.map((m: any) => `${m.families?.name || "알 수 없는 가족"} (${m.role})`).join(", ") || "없음" },
    { key: "reason", header: "사유", render: (r) => r.withdrawal_reason || "-" },
    { key: "actions", header: "액션", render: (r) => (
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => handleAction(r.id, "reject")} disabled={actionLoading === r.id} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--admin-danger)", background: "white", color: "var(--admin-danger)", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>거절</button>
        <button onClick={() => handleAction(r.id, "approve")} disabled={actionLoading === r.id} style={{ padding: "6px 12px", borderRadius: "8px", border: "none", background: "var(--admin-primary)", color: "white", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>승인</button>
      </div>
    )}
  ];

  return (
    <div>
      <AdminPageHeader title="계정 복구 신청 목록" description="탈퇴 유저의 계정 복구 신청을 처리합니다." />
      <AdminDataTable
        columns={columns}
        data={requests || []}
        keyExtractor={(r) => r.id}
        isLoading={loading}
        emptyMessage="복구 신청 내역이 없습니다."
      />
    </div>
  );
}

function AdminDashboard() {
  const [page, setPage] = useState<AdminPageId>("overview");
  const [period, setPeriod] = useState<Period>("month");
  const [mode, setMode] = useState<ModeBucket | "">(""); // "" = 전체 A~F
  const [data, setData] = useState<UsageOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // 비용 상세(나갈 돈) 탭 아코디언 — 같은 레벨엔 단일 선택만 유지(새로 열면 이전 건 자동 접힘).
  // TOP10/티어 목록 자체는 그대로 인라인 아코디언 유지(상위 레벨, 이번 전환 대상 아님).
  const [expandedServiceKey, setExpandedServiceKey] = useState<string | null>(null);
  // 매출·가입자 상세 탭 아코디언
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  // 유저 상세(ChildDetailPanel) — 비용 탭/매출 탭 두 진입점을 단일 공유 상태로 통합.
  // 어느 탭에서 열든 동일한 우측 슬라이드 패널이 열리고, 탭을 전환해도 패널은 유지된다.
  // period는 클릭 시점 값을 캡처해 패널이 자체 보유(탭 목록의 현재 period를 따르지 않음).
  const [selectedChildUser, setSelectedChildUser] = useState<{ childId: string; childName: string; period: Period } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadFailed(false);
    fetch(`/api/admin/usage-overview?period=${period}${mode ? `&mode=${mode}` : ""}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [period, mode]);

  // 내보내기(익명 집계) — 현재 기간·모드 필터를 그대로 전달. CSV/XLSX만 노출(JSON은 dev/QA API 전용).
  const exportHref = (fmt: "csv" | "xlsx") =>
    `/api/admin/usage-overview/export?period=${period}${mode ? `&mode=${mode}` : ""}&format=${fmt}`;

  const toggleService = (key: string) => {
    setExpandedServiceKey((prev) => (prev === key ? null : key));
  };
  const toggleTier = (tier: number) => {
    setExpandedTier((prev) => (prev === tier ? null : tier));
  };
  const openChildPanel = (childId: string, childName: string) => {
    // period는 클릭 시점 값을 캡처해 고정 — 탭을 전환해도 패널의 period는 변하지 않는다.
    setSelectedChildUser({ childId, childName, period });
  };
  const closeChildPanel = () => setSelectedChildUser(null);

  return (
    <AdminShell activeMenuId={page} onMenuChange={setPage}>
      <div style={{ minWidth: 0 }}>
        {page === "llm-status" ? (
          <>
            <LlmStatusTab />
            <GCAIProfileSection />
          </>
        ) : page === "account-restore" ? (
          <AccountRestoreTab />
        ) : page === "feedback" ? (
          <FeedbackTab />
        ) : page === "beta-applications" ? (
          <BetaApplicationsTab />
        ) : page === "manual-reporting" ? (
          <ManualReportingTab />
        ) : page === "plan-change-requests" ? (
          <PlanChangeRequestsTab />
        ) : page === "child-approval-requests" ? (
          <ChildApprovalRequestsTab />
        ) : page === "retention" ? (
          <RetentionEmbed />
        ) : page === "events-overview" ? (
          <EventsOverviewTab />
        ) : page === "events-mission-onboarding" ? (
          <MissionOnboardingEventsTab />
        ) : page === "events-quiz-leaderboard" ? (
          <QuizLeaderboardEventsTab />
        ) : page === "events-reward-fulfillments" ? (
          <RewardFulfillmentsTab />
        ) : (
          <>
        {/* 기간 필터 — 사용량 관련 탭 공통 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: period === p ? 700 : 400,
                border: period === p ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                background: period === p ? "var(--admin-focus)" : "var(--admin-surface)",
                color: period === p ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                cursor: "pointer",
              }}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {/* A~F 대화방식 필터 + 익명 내보내기 — 사용량/비용 탭 공통 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginRight: 2 }}>대화방식</span>
          {(["", ...ALL_MODE_BUCKETS] as (ModeBucket | "")[]).map((m) => {
            const label = m === "" ? "전체" : m === "unclassified" ? "미분류" : m;
            const activeM = mode === m;
            return (
              <button
                key={m || "all"}
                onClick={() => setMode(m)}
                title={m && m !== "unclassified" ? MODE_LABELS[m as ModeBucket] : undefined}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: activeM ? 700 : 400,
                  border: activeM ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                  background: activeM ? "var(--admin-focus)" : "var(--admin-surface)",
                  color: activeM ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <a
            href={exportHref("csv")}
            style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid var(--admin-border)", background: "var(--admin-surface)", color: "var(--admin-text-primary)", textDecoration: "none" }}
          >
            ⬇ CSV
          </a>
          <a
            href={exportHref("xlsx")}
            style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid var(--admin-border)", background: "var(--admin-surface)", color: "var(--admin-text-primary)", textDecoration: "none" }}
          >
            ⬇ XLSX
          </a>
        </div>

        {loadFailed ? (
          <EmptyState text="사용량 데이터를 불러오지 못했어요." />
        ) : !data ? (
          <EmptyState text="불러오는 중..." />
        ) : (
          <>
            {page === "overview" && (
              <>
                {/* ━━━━━━━━━━ 한눈에 — 3초 안에 흑자/적자 파악 (데스크톱 3열 고정, 모바일만 세로 스택) ━━━━━━━━━━ */}
                <div className="hb-top-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14, alignItems: "stretch" }}>
                  <style jsx>{`
                    @media (max-width: 640px) {
                      .hb-top-cards {
                        grid-template-columns: 1fr !important;
                      }
                    }
                  `}</style>
                  <BigNumberCard
                    label="들어올 돈 (총 예상 매출)"
                    value={won(data.profitSummary.projectedRevenueKrw)}
                    sub="가입 사용자 요금제 합계 · 전원 유료 가정"
                    changeRate={data.profitSummary.changeRate.revenue}
                    onClick={() => setPage("revenue")}
                  />
                  <BigNumberCard
                    label="나갈 돈 (총 비용)"
                    value={won(data.profitSummary.costKrw)}
                    sub="AI 4종(STT/TTS/Live/LLM) + 인프라 고정비(Vercel/Supabase)"
                    changeRate={data.profitSummary.changeRate.cost}
                    onClick={() => setPage("cost")}
                  />
                  <BigNumberCard
                    label={`남는 돈 (순이익) · ${data.profitSummary.netProfitKrw >= 0 ? "흑자" : "적자"}`}
                    value={won(data.profitSummary.netProfitKrw)}
                    color={data.profitSummary.netProfitKrw >= 0 ? "var(--admin-success)" : "var(--admin-danger)"}
                    borderColor={data.profitSummary.netProfitKrw >= 0 ? "var(--admin-success)" : "var(--admin-danger)"}
                    sub={
                      `들어올 돈 − 나갈 돈` +
                      (data.profitSummary.revenueMode === "projected" ? " · 현재 전원 무료 제공 기간, 유료 전환 가정한 예상치" : "")
                    }
                    changeRate={data.profitSummary.changeRate.profit}
                  />
                </div>

                {/* 실제 vs 예상 손익 — 무료 제공 기간 명확 구분(Plan01 §23 결정3) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "14px 18px", borderLeft: "4px solid var(--admin-danger)" }}>
                    <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginBottom: 6, fontWeight: 700 }}>
                      실제 손익 {data.profitSummary.isFreePeriod && <span style={{ color: "var(--admin-danger)" }}>· 무료 제공 기간</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--admin-text-primary)" }}>
                      실매출 <b>{won(data.profitSummary.actual.revenueKrw)}</b> − 실비용 <b>{won(data.profitSummary.actual.costKrw)}</b>
                    </div>
                    <div style={{ fontSize: "clamp(15px,1.6vw,20px)", fontWeight: 800, marginTop: 4, color: data.profitSummary.actual.netProfitKrw >= 0 ? "var(--admin-success)" : "var(--admin-danger)" }}>
                      = {won(data.profitSummary.actual.netProfitKrw)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 4 }}>
                      비용 근거: {data.profitSummary.actual.costBasis === "bigquery_actual" ? "BigQuery 실청구(회사 전체)" : "추정치"} · 환율 {data.fx.usdToKrw.toLocaleString("ko-KR")}원({data.fx.asOf})
                    </div>
                  </div>
                  <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "14px 18px", borderLeft: "4px solid var(--admin-primary)" }}>
                    <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginBottom: 6, fontWeight: 700 }}>예상 손익 · 전원 유료 가정</div>
                    <div style={{ fontSize: 13, color: "var(--admin-text-primary)" }}>
                      예상매출 <b>{won(data.profitSummary.projected.revenueKrw)}</b> − 비용 <b>{won(data.profitSummary.projected.costKrw)}</b>
                    </div>
                    <div style={{ fontSize: "clamp(15px,1.6vw,20px)", fontWeight: 800, marginTop: 4, color: data.profitSummary.projected.netProfitKrw >= 0 ? "var(--admin-success)" : "var(--admin-danger)" }}>
                      = {won(data.profitSummary.projected.netProfitKrw)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 4 }}>{data.profitSummary.note}</div>
                  </div>
                </div>

                {/* 보조 요약 — 한 줄 카드 */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  <div style={{ background: "var(--admin-surface)", borderRadius: 10, border: "1px solid var(--admin-border)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                    <div style={{ color: "var(--admin-text-secondary)" }}>총 가입 고객(아이)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text-primary)" }}>{data.subSummary.totalChildren}명</div>
                  </div>
                  {data.subSummary.byTier.map((t) => (
                    <div key={t.tier} style={{ background: "var(--admin-surface)", borderRadius: 10, border: "1px solid var(--admin-border)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                      <div style={{ color: "var(--admin-text-secondary)" }}>{t.name}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text-primary)" }}>{t.count}명</div>
                      <div style={{ fontSize: 11, color: "var(--admin-text-secondary)" }}>{won(t.priceKrw)}/월</div>
                    </div>
                  ))}
                  <div style={{ background: "var(--admin-surface)", borderRadius: 10, border: "1px solid var(--admin-border)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                    <div style={{ color: "var(--admin-text-secondary)" }}>대화 세션 수</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text-primary)" }}>{data.traffic.sessionCount}건</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: -8, marginBottom: 16 }}>
                  계산 근거: 각 요금제 금액 × 가입 인원 = 매출(현재 무료 베타 기간이라 전원 유료 전환 가정)
                </div>

                {/* 일별 손익 추이 그래프 */}
                <SectionTitle>일별 손익 추이</SectionTitle>
                <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: 16, height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.dailyTrend.map((d) => ({ day: d.day, 매출: Math.round(d.revenueKrw), 비용: Math.round(d.costKrw) }))}
                      margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} width={70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => won(typeof v === "number" ? v : Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="매출" stroke="var(--admin-success)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="비용" stroke="var(--admin-danger)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {page === "cost" && (
              <div>
                {data.reconciliation ? (
                  <div className="hb-recon-cards" style={{
                    display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14,
                    ...(data.reconciliation.warning ? { border: "2px solid var(--admin-danger)", padding: 12, borderRadius: 16 } : {})
                  }}>
                    <style jsx>{`
                      @media (max-width: 640px) {
                        .hb-recon-cards {
                          grid-template-columns: 1fr !important;
                        }
                      }
                    `}</style>
                    {data.reconciliation.warning && (
                      <div style={{ gridColumn: "1 / -1", color: "var(--admin-danger)", fontWeight: 700, marginBottom: -4 }}>
                        ⚠️ 실제 비용이 내부 추정보다 10% 이상 큽니다
                      </div>
                    )}
                    <BigNumberCard label="실제 원가" value={won(data.reconciliation.actualGrossKrw)} />
                    <BigNumberCard label="내부 추정 원가" value={won(data.reconciliation.estimateKrw)} />
                    <BigNumberCard 
                      label="차이·배수" 
                      value={won(data.reconciliation.differenceKrw)} 
                      sub={`과소추정률 ${data.reconciliation.underestimationRatePct.toFixed(1)}% · ${data.reconciliation.multiplier?.toFixed(2) ?? "-"}배`}
                      color={data.reconciliation.differenceKrw > 0 ? "var(--admin-danger)" : "var(--admin-success)"}
                    />
                  </div>
                ) : (
                  <div style={{ marginBottom: 14, padding: "16px 20px", background: "var(--admin-surface)", borderRadius: 14, border: "1px solid var(--admin-border)", color: "var(--admin-text-secondary)", fontSize: 14 }}>
                    BigQuery 미설정
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <BigNumberCard label="총발생원가" value={won(data.companyWideCost.totalIncurredKrw)} sub="고정비+GCP 실사용원가, 크레딧 적용 전" />
                  <BigNumberCard label="예상 현금지출" value={won(data.companyWideCost.expectedCashOutlayKrw)} sub="고정비+GCP 순청구액, 크레딧 적용 후" />
                </div>

                {data.actualCost.unclassified.warning && (
                  <div style={{ background: "var(--admin-focus)", color: "var(--admin-danger)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 600 }}>
                    ⚠️ 미분류 비용 {data.actualCost.unclassified.count}건, 전체의 {data.actualCost.unclassified.ratePct.toFixed(2)}% ({won(data.actualCost.unclassified.grossKrw)}) — {data.actualCost.unclassified.services.join(', ')}
                  </div>
                )}

                <SectionTitle>나갈 돈 — 비용 항목별 분해 ({PERIOD_LABEL[period]}, 비용 큰 순)</SectionTitle>
                <AdminDataTable
                  columns={[
                    { key: "category", header: "항목", render: (item) => {
                      const isTopUserService = item.category === "ai" && topUsersByServiceKeys.includes(item.key);
                      const isGeminiDetail = item.key === "gemini_agent_platform";
                      const isOpen = expandedServiceKey === item.key;
                      return (
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {item.label}
                          {isTopUserService && <span style={{ fontSize: 11, color: "var(--admin-primary)", marginLeft: 6 }}>{isOpen ? "▲" : "▶"} TOP10</span>}
                          {isGeminiDetail && <span style={{ fontSize: 11, color: "var(--admin-primary)", marginLeft: 6 }}>{isOpen ? "▲" : "▶"} 오디오/텍스트 상세</span>}
                        </div>
                      );
                    } },
                    { key: "usage", header: "사용량", render: (item) => usageLabel(item.usage, item.usageUnit) },
                    { key: "gross", header: "실제 사용 원가(gross)", render: (item) => won(item.grossKrw) },
                    { key: "credit", header: "크레딧 및 할인(credit)", render: (item) => <span style={{ color: "var(--admin-danger)" }}>{won(item.creditKrw)}</span> },
                    { key: "net", header: "실제 청구 예정액(net)", render: (item) => won(item.netKrw) },
                    { key: "estimate", header: "내부 배분 추정(estimate)", render: (item) => item.estimateKrw === null ? (item.category === "infra" ? "해당없음" : "—") : won(item.estimateKrw) },
                    { key: "variance", header: "추정 오차(variance)", render: (item) => <span style={{ color: item.varianceKrw == null ? undefined : item.varianceKrw > 0 ? "var(--admin-danger)" : "var(--admin-success)" }}>{item.varianceKrw === null ? "—" : won(item.varianceKrw)}</span> },
                    { key: "share", header: "전체 비중", render: (item) => `${item.sharePct.toFixed(1)}%` }
                  ]}
                  data={data.costBreakdown}
                  keyExtractor={(item) => item.key}
                  onRowClick={(item) => {
                    const isTopUserService = item.category === "ai" && topUsersByServiceKeys.includes(item.key);
                    const isGeminiDetail = item.key === "gemini_agent_platform";
                    if (isTopUserService || isGeminiDetail) toggleService(item.key);
                  }}
                  expandedRowIds={new Set(expandedServiceKey ? [expandedServiceKey] : [])}
                  expandedRowRender={(item) => {
                    if (item.key === "gemini_agent_platform") {
                      return (
                        <div style={{ padding: "var(--admin-space-16)" }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--admin-primary)", marginBottom: 10 }}>Gemini 사용 형태별 상세</div>
                          <AdminDataTable
                            columns={[
                              { key: "dim", header: "항목", render: (d) => d.label },
                              { key: "gross", header: "실제 사용 원가(gross)", render: (d) => won(d.data.grossKrw) },
                              { key: "credit", header: "크레딧(credit)", render: (d) => <span style={{ color: "var(--admin-danger)" }}>{won(d.data.creditKrw)}</span> },
                              { key: "net", header: "순 원가(net)", render: (d) => won(d.data.netKrw) }
                            ]}
                            data={[
                              { key: "input_audio", label: "입력 오디오", data: data.actualCost.geminiUsageDimensions.input_audio },
                              { key: "output_audio", label: "출력 오디오", data: data.actualCost.geminiUsageDimensions.output_audio },
                              { key: "text_input", label: "텍스트 입력", data: data.actualCost.geminiUsageDimensions.text_input },
                              { key: "text_output", label: "텍스트 출력", data: data.actualCost.geminiUsageDimensions.text_output },
                              { key: "other", label: "기타", data: data.actualCost.geminiUsageDimensions.other },
                            ]}
                            keyExtractor={(d) => d.key}
                            density="compact"
                          />
                        </div>
                      );
                    }
                    if (topUsersByServiceKeys.includes(item.key)) {
                      const topUsers = data.topUsersByService[item.key] ?? [];
                      if (topUsers.length === 0) return <div style={{ padding: "var(--admin-space-16)" }}>이 서비스를 사용한 아이가 없어요.</div>;
                      return (
                        <div style={{ padding: "var(--admin-space-16)" }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--admin-primary)", marginBottom: 10 }}>{item.label} 사용량 TOP10</div>
                          <AdminDataTable
                            columns={[
                              { key: "rank", header: "순위", render: (u) => topUsers.indexOf(u) + 1 },
                              { key: "child", header: "아이", render: (u) => u.name },
                              { key: "usage", header: "사용량", render: (u) => usageLabel(u.usage, item.usageUnit) },
                              { key: "cost", header: "비용", render: (u) => won(u.costKrw) }
                            ]}
                            data={topUsers}
                            keyExtractor={(u) => u.childId}
                            onRowClick={(u) => openChildPanel(u.childId, u.name)}
                            density="compact"
                          />
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 6 }}>AI 서비스 항목을 클릭하면 바로 아래에 TOP10 유저가 펼쳐집니다.</div>

                {/* A~F 대화방식별 원가 배분 (Plan01 §23 결정1) */}
                <SectionTitle>A~F 대화방식별 원가 배분 ({PERIOD_LABEL[period]})</SectionTitle>
                <div style={{ overflowX: "auto", background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>대화방식</th>
                        <th style={thStyle}>이벤트 수</th>
                        <th style={thStyle}>STT</th>
                        <th style={thStyle}>TTS</th>
                        <th style={thStyle}>Live</th>
                        <th style={thStyle}>LLM</th>
                        <th style={thStyle}>합계(추정원가)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.modeBreakdown.filter((r) => r.eventCount > 0).length === 0 ? (
                        <tr><td colSpan={7} style={tdStyle}><EmptyState text="기간 내 대화방식별 원가 데이터가 없어요." /></td></tr>
                      ) : (
                        data.modeBreakdown.filter((r) => r.eventCount > 0).map((r) => (
                          <tr key={r.mode} style={r.mode === "unclassified" ? { background: "var(--admin-focus)" } : undefined}>
                            <td style={tdStyle}>{MODE_LABELS[r.mode]}</td>
                            <td style={tdStyle}>{r.eventCount.toLocaleString("ko-KR")}</td>
                            <td style={tdStyle}>{won(r.stt)}</td>
                            <td style={tdStyle}>{won(r.tts)}</td>
                            <td style={tdStyle}>{won(r.live_audio)}</td>
                            <td style={tdStyle}>{won(r.llm)}</td>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>{won(r.totalKrw)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 6 }}>
                  A~F 태깅 이전/미지정 이벤트는 <b>미분류</b>로 집계됩니다. 위 값은 usage_events 추정 원가 기준이며, 회사 전체 실청구(BigQuery)는 아이/모드 단위로 직접 쪼갤 수 없어 사용량 비중 기반 배분 추정입니다.
                </div>
              </div>
            )}

            {page === "revenue" && (
              <div>
                <SectionTitle>들어올 돈 — 요금제별 인원 분포 ({PERIOD_LABEL[period]})</SectionTitle>
                <div style={{ overflowX: "auto", background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>요금제</th>
                        <th style={thStyle}>인원</th>
                        <th style={thStyle}>월 요금</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.subSummary.byTier.map((t) => {
                        const isOpen = expandedTier === t.tier;
                        const tierUsers = data.perChildProfitability.filter((c) => c.tier === t.tier);
                        return (
                          <Fragment key={t.tier}>
                            <tr
                              onClick={() => toggleTier(t.tier)}
                              style={{ cursor: "pointer", background: isOpen ? "var(--admin-focus)" : undefined }}
                            >
                              <td style={tdStyle}>
                                {t.name}
                                <span style={{ fontSize: 11, color: "var(--admin-primary)", marginLeft: 6 }}>{isOpen ? "▲" : "▶"} 유저 목록</span>
                              </td>
                              <td style={tdStyle}>{t.count}명</td>
                              <td style={tdStyle}>{won(t.priceKrw)}/월</td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={3} style={{ padding: 0, borderBottom: "1px solid var(--admin-border)" }}>
                                  <AccordionExpand>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--admin-primary)", marginBottom: 10 }}>
                                      {t.name} 소속 유저 목록
                                    </div>
                                    {tierUsers.length === 0 ? (
                                      <EmptyState text="이 요금제에 가입한 아이가 없어요." />
                                    ) : (
                                      <div style={{ overflowX: "auto", background: "var(--admin-surface)", borderRadius: 12 }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead>
                                            <tr>
                                              <th style={thStyle}>아이</th>
                                              <th style={thStyle}>가입일</th>
                                              <th style={thStyle}>월 요금(매출)</th>
                                              <th style={thStyle}>이번 기간 원가</th>
                                              <th style={thStyle}>마진</th>
                                              <th style={thStyle}>마진율</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {tierUsers.map((c) => {
                                              const userSelected = selectedChildUser?.childId === c.childId;
                                              return (
                                                <tr
                                                  key={c.childId}
                                                  onClick={() => openChildPanel(c.childId, c.name)}
                                                  style={{ cursor: "pointer", background: userSelected ? "var(--admin-focus)" : undefined }}
                                                >
                                                  <td style={tdStyle}>{c.name}</td>
                                                  <td style={tdStyle}>{c.createdAt ? formatDateTime(c.createdAt).slice(0, 10) : "-"}</td>
                                                  <td style={tdStyle}>{won(c.priceKrw)}</td>
                                                  <td style={tdStyle}>{won(c.costKrw)}</td>
                                                  <td style={{ ...tdStyle, color: c.marginKrw >= 0 ? "var(--admin-success)" : "var(--admin-danger)", fontWeight: 600 }}>
                                                    {won(c.marginKrw)}
                                                  </td>
                                                  <td style={{ ...tdStyle, color: c.marginRate >= 0 ? "var(--admin-success)" : "var(--admin-danger)" }}>
                                                    {c.marginRate.toFixed(1)}%
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </AccordionExpand>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 6 }}>요금제 행을 클릭하면 바로 아래에 소속 유저 목록이 펼쳐집니다.</div>
              </div>
            )}
          </>
        )}
          </>
        )}
      </div>

      <ChildRightPanel selected={selectedChildUser} onClose={closeChildPanel} />
    </AdminShell>
  );
}

const SUBCATEGORY_LABEL: Record<string, string> = {
  violence: "폭력",
  self_harm: "자해",
  threat: "위협",
  inappropriate_contact: "부적절한 접촉",
  neglect: "방임",
};

function SafetyTab({ childId }: { childId: string }) {
  const [events, setEvents] = useState<SafetyEvent[] | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    fetch(`/api/admin/safety-events?childId=${childId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEvents(d.events ?? []); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [childId]);

  if (events === null) return <EmptyState text="불러오는 중..." />;
  if (events.length === 0) return <EmptyState text="안전 이벤트가 없어요." />;

  const filteredEvents = events.filter((e) => {
    if (selectedSubcategory && e.subcategory !== selectedSubcategory) {
      return false;
    }
    const eventDate = e.created_at.substring(0, 10);
    if (startDate && eventDate < startDate) {
      return false;
    }
    if (endDate && eventDate > endDate) {
      return false;
    }
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 필터 UI */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--admin-text-secondary)", fontWeight: 500 }}>분류</span>
          <select
            value={selectedSubcategory}
            onChange={(e) => setSelectedSubcategory(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
              fontSize: 13,
              color: "var(--admin-text-primary)",
              background: "var(--admin-surface)",
              outline: "none",
            }}
          >
            <option value="">전체</option>
            {Object.entries(SUBCATEGORY_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--admin-text-secondary)", fontWeight: 500 }}>기간</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
              fontSize: 13,
              color: "var(--admin-text-primary)",
              background: "var(--admin-surface)",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--admin-text-secondary)" }}>~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
              fontSize: 13,
              color: "var(--admin-text-primary)",
              background: "var(--admin-surface)",
              outline: "none",
            }}
          />
        </div>

        {(selectedSubcategory || startDate || endDate) && (
          <button
            onClick={() => {
              setSelectedSubcategory("");
              setStartDate("");
              setEndDate("");
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--admin-primary)",
              fontSize: 13,
              cursor: "pointer",
              padding: "4px 8px",
              fontWeight: 500,
            }}
          >
            필터 초기화
          </button>
        )}
      </div>

      {filteredEvents.length === 0 ? (
        <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "16px 0" }}>
          <EmptyState text="조건에 맞는 이벤트가 없어요." />
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>시각</th>
                <th style={thStyle}>분류</th>
                <th style={thStyle}>발화 원문</th>
                <th style={thStyle}>확인여부</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((e) => (
                <tr key={e.id}>
                  <td style={tdStyle}>{formatDateTime(e.created_at)}</td>
                  <td style={{ ...tdStyle, color: "var(--admin-danger)", fontWeight: 600 }}>
                    {SUBCATEGORY_LABEL[e.subcategory] ?? e.subcategory}
                  </td>
                  <td style={tdStyle}>{e.child_text}</td>
                  <td style={tdStyle}>{e.viewed_at ? "확인함" : "미확인"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return <AdminDashboard />;
}
