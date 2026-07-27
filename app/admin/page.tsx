"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import FeedbackTab from "./FeedbackTab";
import ManualReportingTab from "./ManualReportingTab";
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
import type { ProviderId, ModelGroup } from "@/app/api/_lib/ai";
import { MODE_LABELS, ALL_MODE_BUCKETS, type ModeBucket } from "@/lib/plan/conversationMode";


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
  color: "var(--color-k-text-secondary)",
  borderBottom: "1px solid var(--color-k-border)",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--color-k-text-primary)",
  borderBottom: "1px solid var(--color-k-border)",
  verticalAlign: "top",
};

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-k-text-secondary)", fontSize: 13 }}>
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
          style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16 }}
        >
          <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginBottom: 8 }}>
            {formatDateTime(s.started_at)} · {s.session_type === "mission" ? "미션" : "자유대화"} · {s.turn_count}턴
            {!s.ended_at && " · 진행중"}
          </div>
          {s.messages.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)" }}>메시지 없음</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.messages.map((m, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: m.role === "k" ? "var(--color-k-navy)" : "var(--color-k-text-primary)" }}>
                    {m.role === "k" ? "케이" : "아이"}
                  </span>
                  <span style={{ color: "var(--color-k-text-primary)" }}>: {m.content}</span>
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
  key: "stt" | "tts" | "live_audio" | "llm" | "vercel" | "supabase" | "cloud_run";
  label: string;
  category: "ai" | "infra";
  usage: number;
  usageUnit: "sec" | "chars" | "tokens" | "days";
  ourEstimateKrw: number;
  gcpActualKrw: number | null;
  confirmedCostKrw: number;
  sharePct: number;
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
  if (rate == null) return { text: "직전 기간 데이터 없음", color: "var(--color-k-text-secondary)" };
  const sign = rate > 0 ? "+" : "";
  const color = rate >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)";
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
        background: "var(--color-k-background)",
        borderRadius: 14,
        boxShadow: "var(--shadow-k-card)",
        padding: "18px 22px",
        minWidth: 0,
        cursor: onClick ? "pointer" : undefined,
        border: borderColor ? `2px solid ${borderColor}` : active ? "2px solid var(--color-k-navy)" : "2px solid transparent",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        {onClick && <span style={{ color: "var(--color-k-navy)", fontWeight: 700 }}>{active ? "▲ 상세 닫기" : "▼ 클릭해서 자세히"}</span>}
      </div>
      <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800, color: color ?? "var(--color-k-text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginTop: 4 }}>{sub}</div>}
      {change && <div style={{ fontSize: 12, color: change.color, marginTop: 4, fontWeight: 600 }}>{change.text}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", margin: "24px 0 10px" }}>{children}</div>;
}

// TOP10 유저 드릴다운이 있는 서비스 — costBreakdown 항목 중 이 키들만 클릭 가능(인프라 고정비는 제외).
const topUsersByServiceKeys = ["stt", "tts", "live_audio", "llm"];

// 인라인 아코디언 펼침 공용 래퍼 — table row 아래(colSpan)에 넣어서 부드럽게 나타나게 한다.
// 스크롤 폭주 방지 규칙은 호출부에서 "같은 레벨엔 단일 선택 state"로 강제한다(새로 열면 이전 건 자동 접힘).
function AccordionExpand({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--color-k-navy-tint)",
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
        <div style={{ background: "var(--color-k-background)", borderRadius: 10, padding: "10px 14px", fontSize: 12, minWidth: 100 }}>
          <div style={{ color: "var(--color-k-text-secondary)" }}>대화 세션 수</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-k-text-primary)" }}>{detail.traffic.sessionCount}건</div>
        </div>
      </div>
      <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12 }}>
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
      <div style={{ marginTop: 12, background: "var(--color-k-background)", borderRadius: 12, padding: 12, height: 180 }}>
        {detail.dailyTrend.length === 0 ? (
          <EmptyState text="기간 내 원가 추이가 없어요." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={detail.dailyTrend.map((d) => ({ day: d.day, 원가: Math.round(d.costKrw) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-k-border)" />
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
    <div style={{ padding: 16, background: "var(--color-k-navy-tint)", borderRadius: 12, marginTop: -4, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-k-navy)", marginBottom: 10 }}>
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
              border: subTab === t.id ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
              background: subTab === t.id ? "var(--color-k-background)" : "transparent",
              color: subTab === t.id ? "var(--color-k-navy)" : "var(--color-k-text-secondary)",
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
          background: "var(--color-k-surface, #fafaf8)",
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
              color: "var(--color-k-text-secondary)",
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

type AdminPageId = "overview" | "revenue" | "cost" | "ai-config" | "account-restore" | "feedback" | "beta-applications" | "manual-reporting";

const ADMIN_NAV_ITEMS: { id: AdminPageId; label: string }[] = [
  { id: "overview", label: "전체 현황" },
  { id: "revenue", label: "매출·가입자 상세" },
  { id: "cost", label: "나갈 돈 · 비용 상세" },
  { id: "ai-config", label: "AI 설정" },
  { id: "account-restore", label: "계정 복구 승인" },
  { id: "feedback", label: "문의·건의·버그 접수" },
  { id: "beta-applications", label: "베타 신청 관리" },
  { id: "manual-reporting", label: "리포팅 수동 실행" },
];

interface ProviderSwitchRow {
  group: ModelGroup;
  provider: ProviderId;
  model_id: string;
  updated_at: string;
  updated_by: string | null;
}

const GROUP_LABEL: Record<ModelGroup, string> = {
  A: "그룹A · 리포트·요약",
  B: "그룹B · 미션 대화",
  C: "그룹C · 라이브 음성",
};

// 그룹별로 스위치 가능한 모델 후보 — ai.ts의 레지스트리와 맞춰둔다.
const MODEL_OPTIONS: Record<ModelGroup, { provider: ProviderId; modelId: string; label: string }[]> = {
  A: [
    { provider: "vertex", modelId: "gemini-2.5-flash", label: "Vertex · gemini-2.5-flash" },
  ],
  B: [
    { provider: "vertex", modelId: "gemini-2.5-flash", label: "Vertex · gemini-2.5-flash" },
  ],
  C: [
    { provider: "vertex", modelId: "gemini-live-2.5-flash-native-audio", label: "Vertex · gemini-live-2.5-flash-native-audio (Cloud Run 릴레이 경유)" },
  ],
};

function ProviderSwitchTab() {
  const [rows, setRows] = useState<ProviderSwitchRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingGroup, setSavingGroup] = useState<ModelGroup | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setLoadFailed(false);
    fetch("/api/admin/provider-switch")
      .then((r) => r.json())
      .then((d) => setRows(d.settings ?? []))
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (group: ModelGroup, provider: ProviderId, modelId: string) => {
    setSavingGroup(group);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/admin/provider-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, provider, modelId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "저장 실패");
        return;
      }
      load();
    } catch {
      setErrorMsg("저장 요청 실패");
    } finally {
      setSavingGroup(null);
    }
  };

  if (loadFailed) return <EmptyState text="설정을 불러오지 못했어요." />;
  if (!rows) return <EmptyState text="불러오는 중..." />;

  return (
    <div>
      <SectionTitle>AI 프로바이더 스위치 (Vertex 전용)</SectionTitle>
      <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginBottom: 12 }}>
        변경은 다음 호출부터 즉시 반영돼요. 단, 그룹C(라이브 음성)는 이미 연결된 세션이 끝날 때까지 기존 설정이 유지돼요.
      </div>
      {errorMsg && <div style={{ fontSize: 12, color: "var(--color-k-danger)", marginBottom: 10 }}>{errorMsg}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(["A", "B", "C"] as ModelGroup[]).map((group) => {
          const row = rows.find((r) => r.group === group);
          const current = row ? `${row.provider}::${row.model_id}` : "";
          return (
            <div key={group} style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-k-text-primary)", marginBottom: 8 }}>{GROUP_LABEL[group]}</div>
              <select
                value={current}
                disabled={savingGroup === group}
                onChange={(e) => {
                  const [provider, modelId] = e.target.value.split("::") as [ProviderId, string];
                  handleChange(group, provider, modelId);
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--color-k-border)",
                  fontSize: 13,
                  color: "var(--color-k-text-primary)",
                  background: "var(--color-k-background)",
                }}
              >
                {MODEL_OPTIONS[group].map((opt) => (
                  <option key={`${opt.provider}::${opt.modelId}`} value={`${opt.provider}::${opt.modelId}`}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {row?.updated_by && (
                <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 6 }}>
                  마지막 변경: {row.updated_by} · {formatDateTime(row.updated_at)}
                </div>
              )}
            </div>
          );
        })}
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
      {errorMsg && <div style={{ fontSize: 12, color: "var(--color-k-danger)", marginBottom: 10 }}>{errorMsg}</div>}
      {actionMsg && <div style={{ fontSize: 12, color: "var(--color-k-navy)", marginBottom: 10, background: "var(--color-k-navy-tint)", padding: "8px 12px", borderRadius: 8 }}>{actionMsg}</div>}
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
            <div key={p.profile} style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16, border: p.is_active ? "2px solid var(--color-k-navy)" : "1px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                    프로필 {p.profile}
                    {p.is_active && <span style={{ fontSize: 11, background: "var(--color-k-navy)", color: "white", padding: "2px 6px", borderRadius: 4 }}>활성</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginTop: 4 }}>
                    Project: {maskProject(p.google_cloud_project)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => runHealthCheck(p.profile)}
                    disabled={healthChecking === p.profile}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-k-border)",
                      background: "white", color: "var(--color-k-text-primary)", fontSize: 12, fontWeight: 700, cursor: "pointer"
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
                      background: (!allPassed || switching === p.profile) ? "var(--color-k-border)" : "var(--color-k-navy)",
                      color: (!allPassed || switching === p.profile) ? "var(--color-k-text-secondary)" : "white",
                      fontSize: 12, fontWeight: 700, cursor: (!allPassed || switching === p.profile) ? "not-allowed" : "pointer"
                    }}
                  >
                    {switching === p.profile ? "전환 중..." : "이 프로필로 전환"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["groupA", "groupB", "groupC", "stt", "tts"].map(svc => {
                  const check = p.last_health_check_result?.[svc];
                  let color = "var(--color-k-text-secondary)";
                  let label = svc.toUpperCase();
                  if (check) {
                    if (check.status === "ok") color = "var(--color-k-success, #1a9c5c)";
                    else if (check.status === "fail") color = "var(--color-k-danger)";
                  }
                  return (
                    <div key={svc} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "white", border: `1px solid ${color}`, color }}>
                      {label}
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

  const handleAction = async (userId: string, action: "approve" | "reject") => {
    let reason = "";
    let tier: number | null = null;
    if (action === "reject") {
      const input = window.prompt("거절 사유를 입력하세요 (선택):");
      if (input === null) return;
      reason = input;
    } else {
      const planLabel = window.prompt(
        "승인할 플랜을 입력하세요.\n1 = Care Start\n2 = Care Insight\n3 = Care Premium"
      );
      if (planLabel === null) return;
      const parsed = Number(planLabel.trim());
      if (![1, 2, 3].includes(parsed)) {
        alert("1, 2, 3 중 하나를 입력해 주세요.");
        return;
      }
      tier = parsed;
      if (!window.confirm(`베타 신청을 승인하시겠습니까? (플랜: ${["", "Care Start", "Care Insight", "Care Premium"][tier]})`)) return;
    }

    setActionLoading(userId);
    try {
      const url = `/api/admin/beta-applications/${userId}/${action}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : { tier })
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

  if (loading && !requests) return <EmptyState text="불러오는 중..." />;
  if (!requests || requests.length === 0) return <EmptyState text="베타 신청 내역이 없습니다." />;

  return (
    <div>
      <SectionTitle>베타 신청 관리</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {requests.map(req => {
          return (
            <div key={req.user_id} style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", marginBottom: 4 }}>
                    이름: {req.name || "미상"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>
                    신청일: {formatDateTime(req.created_at)}<br />
                    전화번호: {req.phone || "없음"}<br />
                    연령대: {req.age_group || "미상"}<br />
                    알게 된 경로: {req.referral_source || "미상"}<br />
                  </div>
                  {req.motivation && (
                    <div style={{ fontSize: 12, color: "var(--color-k-text-primary)", marginTop: 8, background: "var(--color-k-surface)", padding: "6px 10px", borderRadius: 6 }}>
                      신청 동기: {req.motivation}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleAction(req.user_id, "reject")}
                    disabled={actionLoading === req.user_id}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-k-danger)",
                      background: "white", color: "var(--color-k-danger)", fontSize: 12, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    거절
                  </button>
                  <button
                    onClick={() => handleAction(req.user_id, "approve")}
                    disabled={actionLoading === req.user_id}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none",
                      background: "var(--color-k-navy)", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    승인
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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

  if (loading && !requests) return <EmptyState text="불러오는 중..." />;
  if (!requests || requests.length === 0) return <EmptyState text="복구 신청 내역이 없습니다." />;

  return (
    <div>
      <SectionTitle>계정 복구 신청 목록</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {requests.map(req => {
          const familyList = req.memberships.map((m: any) => `${m.families?.name || "알 수 없는 가족"} (${m.role})`).join(", ");
          return (
            <div key={req.id} style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", marginBottom: 4 }}>
                    {req.name} ({req.email})
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>
                    탈퇴일: {formatDateTime(req.withdrawn_at)}<br />
                    삭제예정일: {formatDateTime(req.purge_scheduled_at)}<br />
                    신청일: {formatDateTime(req.restore_requested_at)}<br />
                    가족: {familyList || "없음"}
                  </div>
                  {req.withdrawal_reason && (
                    <div style={{ fontSize: 12, color: "#d97706", marginTop: 8, background: "#fef3c7", padding: "6px 10px", borderRadius: 6 }}>
                      탈퇴 사유: {req.withdrawal_reason}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleAction(req.id, "reject")}
                    disabled={actionLoading === req.id}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-k-danger)",
                      background: "white", color: "var(--color-k-danger)", fontSize: 12, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    거절
                  </button>
                  <button
                    onClick={() => handleAction(req.id, "approve")}
                    disabled={actionLoading === req.id}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none",
                      background: "var(--color-k-navy)", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    승인
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      {/* 왼쪽 사이드바 네비게이션 */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, width: 180, flexShrink: 0 }}>
        {ADMIN_NAV_ITEMS.map((item) => {
          if (item.id === "manual-reporting" && process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod") return null;
          return (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            style={{
              textAlign: "left",
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: page === item.id ? 700 : 400,
              border: "none",
              background: page === item.id ? "var(--color-k-navy-tint)" : "transparent",
              color: page === item.id ? "var(--color-k-navy)" : "var(--color-k-text-secondary)",
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        {page === "ai-config" ? (
          <>
            <ProviderSwitchTab />
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
                border: period === p ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
                background: period === p ? "var(--color-k-navy-tint)" : "var(--color-k-background)",
                color: period === p ? "var(--color-k-navy)" : "var(--color-k-text-secondary)",
                cursor: "pointer",
              }}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {/* A~F 대화방식 필터 + 익명 내보내기 — 사용량/비용 탭 공통 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginRight: 2 }}>대화방식</span>
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
                  border: activeM ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
                  background: activeM ? "var(--color-k-navy-tint)" : "var(--color-k-background)",
                  color: activeM ? "var(--color-k-navy)" : "var(--color-k-text-secondary)",
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
            style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid var(--color-k-border)", background: "var(--color-k-background)", color: "var(--color-k-text-primary)", textDecoration: "none" }}
          >
            ⬇ CSV
          </a>
          <a
            href={exportHref("xlsx")}
            style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid var(--color-k-border)", background: "var(--color-k-background)", color: "var(--color-k-text-primary)", textDecoration: "none" }}
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
                    color={data.profitSummary.netProfitKrw >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)"}
                    borderColor={data.profitSummary.netProfitKrw >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)"}
                    sub={
                      `들어올 돈 − 나갈 돈` +
                      (data.profitSummary.revenueMode === "projected" ? " · 현재 전원 무료 제공 기간, 유료 전환 가정한 예상치" : "")
                    }
                    changeRate={data.profitSummary.changeRate.profit}
                  />
                </div>

                {/* 실제 vs 예상 손익 — 무료 제공 기간 명확 구분(Plan01 §23 결정3) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: "14px 18px", borderLeft: "4px solid var(--color-k-danger)" }}>
                    <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginBottom: 6, fontWeight: 700 }}>
                      실제 손익 {data.profitSummary.isFreePeriod && <span style={{ color: "var(--color-k-danger)" }}>· 무료 제공 기간</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-k-text-primary)" }}>
                      실매출 <b>{won(data.profitSummary.actual.revenueKrw)}</b> − 실비용 <b>{won(data.profitSummary.actual.costKrw)}</b>
                    </div>
                    <div style={{ fontSize: "clamp(15px,1.6vw,20px)", fontWeight: 800, marginTop: 4, color: data.profitSummary.actual.netProfitKrw >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)" }}>
                      = {won(data.profitSummary.actual.netProfitKrw)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 4 }}>
                      비용 근거: {data.profitSummary.actual.costBasis === "bigquery_actual" ? "BigQuery 실청구(회사 전체)" : "추정치"} · 환율 {data.fx.usdToKrw.toLocaleString("ko-KR")}원({data.fx.asOf})
                    </div>
                  </div>
                  <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: "14px 18px", borderLeft: "4px solid var(--color-k-navy)" }}>
                    <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginBottom: 6, fontWeight: 700 }}>예상 손익 · 전원 유료 가정</div>
                    <div style={{ fontSize: 13, color: "var(--color-k-text-primary)" }}>
                      예상매출 <b>{won(data.profitSummary.projected.revenueKrw)}</b> − 비용 <b>{won(data.profitSummary.projected.costKrw)}</b>
                    </div>
                    <div style={{ fontSize: "clamp(15px,1.6vw,20px)", fontWeight: 800, marginTop: 4, color: data.profitSummary.projected.netProfitKrw >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)" }}>
                      = {won(data.profitSummary.projected.netProfitKrw)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 4 }}>{data.profitSummary.note}</div>
                  </div>
                </div>

                {/* 보조 요약 — 한 줄 카드 */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  <div style={{ background: "var(--color-k-background)", borderRadius: 10, boxShadow: "var(--shadow-k-card)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                    <div style={{ color: "var(--color-k-text-secondary)" }}>총 가입 고객(아이)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-k-text-primary)" }}>{data.subSummary.totalChildren}명</div>
                  </div>
                  {data.subSummary.byTier.map((t) => (
                    <div key={t.tier} style={{ background: "var(--color-k-background)", borderRadius: 10, boxShadow: "var(--shadow-k-card)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                      <div style={{ color: "var(--color-k-text-secondary)" }}>{t.name}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-k-text-primary)" }}>{t.count}명</div>
                      <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{won(t.priceKrw)}/월</div>
                    </div>
                  ))}
                  <div style={{ background: "var(--color-k-background)", borderRadius: 10, boxShadow: "var(--shadow-k-card)", padding: "10px 14px", fontSize: 12, minWidth: 110 }}>
                    <div style={{ color: "var(--color-k-text-secondary)" }}>대화 세션 수</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-k-text-primary)" }}>{data.traffic.sessionCount}건</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: -8, marginBottom: 16 }}>
                  계산 근거: 각 요금제 금액 × 가입 인원 = 매출(현재 무료 베타 기간이라 전원 유료 전환 가정)
                </div>

                {/* 일별 손익 추이 그래프 */}
                <SectionTitle>일별 손익 추이</SectionTitle>
                <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16, height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.dailyTrend.map((d) => ({ day: d.day, 매출: Math.round(d.revenueKrw), 비용: Math.round(d.costKrw) }))}
                      margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-k-border)" />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} width={70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => won(typeof v === "number" ? v : Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="매출" stroke="var(--color-k-success, #1a9c5c)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="비용" stroke="var(--color-k-danger)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {page === "cost" && (
              <div>
                <SectionTitle>나갈 돈 — 비용 항목별 분해 ({PERIOD_LABEL[period]}, 비용 큰 순)</SectionTitle>
                <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>항목</th>
                        <th style={thStyle}>사용량</th>
                        <th style={thStyle}>우리 추정</th>
                        <th style={thStyle}>실제 청구액</th>
                        <th style={thStyle}>전체 비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.costBreakdown.map((item) => {
                        const isTopUserService = item.category === "ai" && topUsersByServiceKeys.includes(item.key);
                        const isOpen = expandedServiceKey === item.key;
                        const topUsers = data.topUsersByService[item.key] ?? [];
                        return (
                          <Fragment key={item.key}>
                            <tr
                              onClick={isTopUserService ? () => toggleService(item.key) : undefined}
                              style={{ cursor: isTopUserService ? "pointer" : undefined, background: isOpen ? "var(--color-k-navy-tint)" : undefined }}
                            >
                              <td style={tdStyle}>
                                {item.label}
                                {isTopUserService && <span style={{ fontSize: 11, color: "var(--color-k-navy)", marginLeft: 6 }}>{isOpen ? "▲" : "▶"} TOP10</span>}
                              </td>
                              <td style={tdStyle}>{usageLabel(item.usage, item.usageUnit)}</td>
                              <td style={tdStyle}>{won(item.ourEstimateKrw)}</td>
                              <td style={tdStyle}>
                                {item.gcpActualKrw != null ? won(item.gcpActualKrw) : item.note ?? (item.category === "infra" ? "고정비" : "BigQuery 미설정")}
                              </td>
                              <td style={tdStyle}>{item.sharePct.toFixed(1)}%</td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid var(--color-k-border)" }}>
                                  <AccordionExpand>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-k-navy)", marginBottom: 10 }}>
                                      {item.label} 사용량 TOP10
                                    </div>
                                    {topUsers.length === 0 ? (
                                      <EmptyState text="이 서비스를 사용한 아이가 없어요." />
                                    ) : (
                                      <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12 }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead>
                                            <tr>
                                              <th style={thStyle}>순위</th>
                                              <th style={thStyle}>아이</th>
                                              <th style={thStyle}>사용량</th>
                                              <th style={thStyle}>비용</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {topUsers.map((u, idx) => {
                                              const userSelected = selectedChildUser?.childId === u.childId;
                                              return (
                                                <tr
                                                  key={u.childId}
                                                  onClick={() => openChildPanel(u.childId, u.name)}
                                                  style={{ cursor: "pointer", background: userSelected ? "var(--color-k-navy-tint)" : undefined }}
                                                >
                                                  <td style={tdStyle}>{idx + 1}</td>
                                                  <td style={tdStyle}>{u.name}</td>
                                                  <td style={tdStyle}>{usageLabel(u.usage, item.usageUnit)}</td>
                                                  <td style={tdStyle}>{won(u.costKrw)}</td>
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
                {data.gcpBillingError && (
                  <div style={{ fontSize: 12, color: "var(--color-k-danger)", marginTop: 6 }}>
                    GCP billing 조회 오류: {data.gcpBillingError}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 6 }}>AI 서비스 항목을 클릭하면 바로 아래에 TOP10 유저가 펼쳐집니다.</div>

                {/* A~F 대화방식별 원가 배분 (Plan01 §23 결정1) */}
                <SectionTitle>A~F 대화방식별 원가 배분 ({PERIOD_LABEL[period]})</SectionTitle>
                <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
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
                          <tr key={r.mode} style={r.mode === "unclassified" ? { background: "var(--color-k-navy-tint)" } : undefined}>
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
                <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 6 }}>
                  A~F 태깅 이전/미지정 이벤트는 <b>미분류</b>로 집계됩니다. 위 값은 usage_events 추정 원가 기준이며, 회사 전체 실청구(BigQuery)는 아이/모드 단위로 직접 쪼갤 수 없어 사용량 비중 기반 배분 추정입니다.
                </div>
              </div>
            )}

            {page === "revenue" && (
              <div>
                <SectionTitle>들어올 돈 — 요금제별 인원 분포 ({PERIOD_LABEL[period]})</SectionTitle>
                <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
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
                              style={{ cursor: "pointer", background: isOpen ? "var(--color-k-navy-tint)" : undefined }}
                            >
                              <td style={tdStyle}>
                                {t.name}
                                <span style={{ fontSize: 11, color: "var(--color-k-navy)", marginLeft: 6 }}>{isOpen ? "▲" : "▶"} 유저 목록</span>
                              </td>
                              <td style={tdStyle}>{t.count}명</td>
                              <td style={tdStyle}>{won(t.priceKrw)}/월</td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={3} style={{ padding: 0, borderBottom: "1px solid var(--color-k-border)" }}>
                                  <AccordionExpand>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-k-navy)", marginBottom: 10 }}>
                                      {t.name} 소속 유저 목록
                                    </div>
                                    {tierUsers.length === 0 ? (
                                      <EmptyState text="이 요금제에 가입한 아이가 없어요." />
                                    ) : (
                                      <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12 }}>
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
                                                  style={{ cursor: "pointer", background: userSelected ? "var(--color-k-navy-tint)" : undefined }}
                                                >
                                                  <td style={tdStyle}>{c.name}</td>
                                                  <td style={tdStyle}>{c.createdAt ? formatDateTime(c.createdAt).slice(0, 10) : "-"}</td>
                                                  <td style={tdStyle}>{won(c.priceKrw)}</td>
                                                  <td style={tdStyle}>{won(c.costKrw)}</td>
                                                  <td style={{ ...tdStyle, color: c.marginKrw >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)", fontWeight: 600 }}>
                                                    {won(c.marginKrw)}
                                                  </td>
                                                  <td style={{ ...tdStyle, color: c.marginRate >= 0 ? "var(--color-k-success, #1a9c5c)" : "var(--color-k-danger)" }}>
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
                <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 6 }}>요금제 행을 클릭하면 바로 아래에 소속 유저 목록이 펼쳐집니다.</div>
              </div>
            )}
          </>
        )}
          </>
        )}
      </div>

      <ChildRightPanel selected={selectedChildUser} onClose={closeChildPanel} />
    </div>
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
          <span style={{ fontSize: 13, color: "var(--color-k-text-secondary)", fontWeight: 500 }}>분류</span>
          <select
            value={selectedSubcategory}
            onChange={(e) => setSelectedSubcategory(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-k-border)",
              fontSize: 13,
              color: "var(--color-k-text-primary)",
              background: "var(--color-k-background)",
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
          <span style={{ fontSize: 13, color: "var(--color-k-text-secondary)", fontWeight: 500 }}>기간</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-k-border)",
              fontSize: 13,
              color: "var(--color-k-text-primary)",
              background: "var(--color-k-background)",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--color-k-text-secondary)" }}>~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-k-border)",
              fontSize: 13,
              color: "var(--color-k-text-primary)",
              background: "var(--color-k-background)",
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
              color: "var(--color-k-navy)",
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
        <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: "16px 0" }}>
          <EmptyState text="조건에 맞는 이벤트가 없어요." />
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
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
                  <td style={{ ...tdStyle, color: "var(--color-k-danger)", fontWeight: 600 }}>
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
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-k-text-primary)", marginBottom: 4 }}>회사 전체 현황</div>
      <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", marginBottom: 20 }}>
        아이를 선택하지 않아도 항상 전체 기준으로 보여요. 왼쪽 탭에서 매출·비용 상세로 바로 이동할 수 있어요.
      </div>
      <AdminDashboard />
    </div>
  );
}
