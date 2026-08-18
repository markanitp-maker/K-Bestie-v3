"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminErrorState } from "@/components/admin/shell/AdminErrorState";
import type {
  UserAnalyticsResponse,
  MetricWithRate,
  ChildUserRow,
  ParentUserRow,
} from "@/lib/admin/userAnalytics";

type PeriodType = "today" | "7d" | "14d" | "30d" | "month" | "lastmonth" | "custom";
type ScopeType = "all" | "family" | "parent" | "child";
type UserTabType = "children" | "parents";

const PERIOD_OPTIONS: Array<[PeriodType, string]> = [
  ["today", "오늘"],
  ["7d", "최근 7일"],
  ["14d", "최근 14일"],
  ["30d", "최근 30일"],
  ["month", "이번 달"],
  ["lastmonth", "지난달"],
  ["custom", "직접 기간"],
];

const SCOPE_OPTIONS: Array<[ScopeType, string]> = [
  ["all", "전체"],
  ["family", "가족"],
  ["parent", "부모"],
  ["child", "아이"],
];

function formatCountAndRate(metric?: MetricWithRate | null, unit = "명"): { value: string; sub?: string } {
  if (!metric) return { value: "-" };
  if (metric.total === 0) {
    return { value: "-", sub: `대상 0${unit}` };
  }
  return {
    value: `${metric.count.toLocaleString()}${unit} (${metric.rate.toFixed(1)}%)`,
    sub: `전체 ${metric.total.toLocaleString()}${unit} 중 ${metric.count.toLocaleString()}${unit}`,
  };
}

function formatRatioValue(metric?: MetricWithRate | null): { value: string; sub?: string } {
  if (!metric) return { value: "-" };
  if (metric.total === 0) {
    return { value: "-", sub: "대상 없음" };
  }
  return {
    value: `완료 ${metric.count.toLocaleString()} / 전체 ${metric.total.toLocaleString()} (${metric.rate.toFixed(1)}%)`,
    sub: `완료율 ${metric.rate.toFixed(1)}%`,
  };
}

function formatKstDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return "-";
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: "16px",
        padding: "var(--admin-space-24)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--admin-space-16)",
      }}
    >
      <div>
        <h2
          style={{
            fontSize: "var(--admin-text-section-title)",
            fontWeight: "var(--admin-weight-section-title)",
            color: "var(--admin-text-primary)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {description && (
          <p
            style={{
              fontSize: "var(--admin-text-sm)",
              color: "var(--admin-text-secondary)",
              marginTop: "var(--admin-space-4)",
              marginBottom: 0,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function UserAnalyticsContent() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = useMemo(() => rawSearchParams ?? new URLSearchParams(), [rawSearchParams]);

  const [period, setPeriod] = useState<PeriodType>(
    (searchParams.get("period") as PeriodType) || "7d",
  );
  const [scope, setScope] = useState<ScopeType>(
    (searchParams.get("scope") as ScopeType) || "all",
  );
  const [includeTestAccounts, setIncludeTestAccounts] = useState<boolean>(
    searchParams.get("includeTestAccounts") === "true",
  );
  const [customFrom, setCustomFrom] = useState<string>(searchParams.get("from") || "");
  const [customTo, setCustomTo] = useState<string>(searchParams.get("to") || "");
  const [appliedCustom, setAppliedCustom] = useState({
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
  });

  const [data, setData] = useState<UserAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Detail section states
  const [activeUserTab, setActiveUserTab] = useState<UserTabType>("children");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [childSortKey, setChildSortKey] = useState<string>("last_used_desc");
  const [parentSortKey, setParentSortKey] = useState<string>("last_used_desc");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("period", period);
    params.set("scope", scope);
    params.set("includeTestAccounts", includeTestAccounts ? "true" : "false");
    if (period === "custom") {
      if (appliedCustom.from) params.set("from", appliedCustom.from);
      if (appliedCustom.to) params.set("to", appliedCustom.to);
    }
    return params.toString();
  }, [period, scope, includeTestAccounts, appliedCustom]);

  const fetchData = useCallback(async () => {
    if (period === "custom" && (!appliedCustom.from || !appliedCustom.to)) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/user-analytics?${queryString}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "사용자 분석 데이터를 불러오지 못했습니다.");
      }
      setData(payload);
      history.replaceState(null, "", `/admin/user-analytics?${queryString}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "사용자 분석 데이터를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [period, appliedCustom, queryString]);

  useEffect(() => {
    fetchData();
  }, [fetchData, reloadKey]);

  const handleMenuChange = (id: AdminPageId) => {
    if (id === "user-analytics") return;
    if (id === "users") router.push("/admin/users");
    else if (id === "customer-requests") router.push("/admin/customer-requests");
    else if (id === "analytics") router.push("/admin/analytics");
    else if (id === "events-rewards") router.push("/admin/events-rewards");
    else if (id === "operations") router.push("/admin/operations");
    else router.push(`/admin?menu=${id}`);
  };

  // Filtered & Sorted Children
  const filteredChildren = useMemo(() => {
    const list = data?.users?.children ?? [];
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter((c) => c.name.toLowerCase().includes(q) || c.familyId.toLowerCase().includes(q))
      : list;

    return [...filtered].sort((a, b) => {
      switch (childSortKey) {
        case "name_asc":
          return a.name.localeCompare(b.name, "ko");
        case "joined_desc":
          return (b.joinedAt || "").localeCompare(a.joinedAt || "");
        case "days7_desc":
          return b.last7ActiveDays - a.last7ActiveDays;
        case "days30_desc":
          return b.last30ActiveDays - a.last30ActiveDays;
        case "mission_desc":
          return b.missionCount - a.missionCount;
        case "freechat_desc":
          return b.freechatCount - a.freechatCount;
        case "play_desc":
          return b.playCount - a.playCount;
        case "report_desc":
          return b.reportCount - a.reportCount;
        case "last_used_desc":
        default:
          return (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "");
      }
    });
  }, [data?.users?.children, searchQuery, childSortKey]);

  // Filtered & Sorted Parents
  const filteredParents = useMemo(() => {
    const list = data?.users?.parents ?? [];
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter((p) => p.name.toLowerCase().includes(q) || p.familyId.toLowerCase().includes(q))
      : list;

    return [...filtered].sort((a, b) => {
      switch (parentSortKey) {
        case "name_asc":
          return a.name.localeCompare(pName(b), "ko");
        case "joined_desc":
          return (b.joinedAt || "").localeCompare(a.joinedAt || "");
        case "days7_desc":
          return b.last7ActiveDays - a.last7ActiveDays;
        case "days30_desc":
          return b.last30ActiveDays - a.last30ActiveDays;
        case "report_view_desc":
          return b.reportViewCount - a.reportViewCount;
        case "last_used_desc":
        default:
          return (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "");
      }
    });
    function pName(p: ParentUserRow) {
      return p.name || "";
    }
  }, [data?.users?.parents, searchQuery, parentSortKey]);

  const childColumns: AdminDataTableColumn<ChildUserRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "아이 이름",
        render: (row) => <strong>{row.name}</strong>,
      },
      {
        key: "familyId",
        header: "가족 ID",
        render: (row) => (
          <span style={{ fontSize: "12px", color: "var(--admin-text-secondary)" }}>
            {row.familyId.substring(0, 8)}...
          </span>
        ),
      },
      {
        key: "lastUsedAt",
        header: "최근 활동",
        render: (row) => formatKstDateTime(row.lastUsedAt),
      },
      {
        key: "joinedAt",
        header: "가입일",
        render: (row) => formatKstDateTime(row.joinedAt),
      },
      {
        key: "last7ActiveDays",
        header: "최근 7일 활성",
        render: (row) => `${row.last7ActiveDays}일`,
      },
      {
        key: "last30ActiveDays",
        header: "최근 30일 활성",
        render: (row) => `${row.last30ActiveDays}일`,
      },
      {
        key: "missionCount",
        header: "미션",
        render: (row) => `${row.missionCount}회`,
      },
      {
        key: "freechatCount",
        header: "자유대화",
        render: (row) => `${row.freechatCount}회`,
      },
      {
        key: "playCount",
        header: "놀이",
        render: (row) => `${row.playCount}회`,
      },
      {
        key: "reportCount",
        header: "리포트 생성",
        render: (row) => `${row.reportCount}건`,
      },
    ],
    [],
  );

  const parentColumns: AdminDataTableColumn<ParentUserRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "부모 이름",
        render: (row) => <strong>{row.name}</strong>,
      },
      {
        key: "familyId",
        header: "가족 ID",
        render: (row) => (
          <span style={{ fontSize: "12px", color: "var(--admin-text-secondary)" }}>
            {row.familyId.substring(0, 8)}...
          </span>
        ),
      },
      {
        key: "lastUsedAt",
        header: "최근 활동",
        render: (row) => formatKstDateTime(row.lastUsedAt),
      },
      {
        key: "joinedAt",
        header: "가입일",
        render: (row) => formatKstDateTime(row.joinedAt),
      },
      {
        key: "last7ActiveDays",
        header: "최근 7일 활성",
        render: (row) => `${row.last7ActiveDays}일`,
      },
      {
        key: "last30ActiveDays",
        header: "최근 30일 활성",
        render: (row) => `${row.last30ActiveDays}일`,
      },
      {
        key: "reportViewCount",
        header: "리포트 열람",
        render: (row) => `${row.reportViewCount}회`,
      },
    ],
    [],
  );

  const signup = data?.signup;
  const usage = data?.usage;
  const repeat = data?.repeat;

  // Formatted KPI helper values
  const activeChildrenFormatted = formatCountAndRate(signup?.activeChildren, "명");
  const missionFormatted = formatCountAndRate(usage?.mission, "명");
  const freechatFormatted = formatCountAndRate(usage?.freechat, "명");
  const playFormatted = formatCountAndRate(usage?.play, "명");
  const missionCompletionFormatted = formatRatioValue(usage?.missionCompletionRate);
  const reportGenFormatted = formatCountAndRate(usage?.reportGenerated, "가족");
  const parentViewedFormatted = formatCountAndRate(usage?.parentViewed, "명");
  const familyRepeatFormatted = formatCountAndRate(repeat?.familyRepeatRate, "가족");

  const distributionLabelMap: Record<string, string> = {
    "0": "0일=미사용",
    "1": "1일=단발",
    "2-4": "2~4일=반복사용",
    "5-7": "5~7일=고활성",
  };

  const distributionColorMap: Record<string, string> = {
    "0": "#94a3b8",
    "1": "#38bdf8",
    "2-4": "#3b82f6",
    "5-7": "#10b981",
  };

  return (
    <AdminShell activeMenuId="user-analytics" onMenuChange={handleMenuChange}>
      <div
        style={{
          minWidth: 0,
          padding: "var(--admin-space-24)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--admin-space-24)",
        }}
      >
        <AdminPageHeader
          title="사용자 분석 대시보드"
          description="가입 현황, 핵심 기능 사용률, 반복 사용 분포 및 아이·부모 상세 활동을 한눈에 파악합니다."
        />

        {/* 필터 바 */}
        <div
          style={{
            background: "var(--admin-surface)",
            border: "1px solid var(--admin-border)",
            borderRadius: "16px",
            padding: "var(--admin-space-16)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--admin-space-12)",
          }}
        >
          {/* 기간 버튼 */}
          <div
            style={{
              display: "flex",
              gap: "var(--admin-space-8)",
              overflowX: "auto",
              paddingBottom: "var(--admin-space-4)",
            }}
          >
            {PERIOD_OPTIONS.map(([key, label]) => {
              const isSelected = period === key;
              return (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  style={{
                    minHeight: "40px",
                    padding: "0 var(--admin-space-16)",
                    borderRadius: "999px",
                    border: `1px solid ${isSelected ? "var(--admin-primary)" : "var(--admin-border)"}`,
                    background: isSelected ? "var(--admin-focus)" : "transparent",
                    color: isSelected ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: "var(--admin-text-sm)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* 직접 기간 선택창 */}
          {period === "custom" && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "var(--admin-space-12)",
                paddingTop: "var(--admin-space-8)",
                borderTop: "1px solid var(--admin-border)",
              }}
            >
              <label
                style={{
                  fontSize: "var(--admin-text-sm)",
                  color: "var(--admin-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--admin-space-8)",
                }}
              >
                시작일
                <input
                  aria-label="시작일"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{
                    minHeight: "38px",
                    padding: "0 var(--admin-space-12)",
                    borderRadius: "8px",
                    border: "1px solid var(--admin-border)",
                    background: "var(--admin-surface)",
                    color: "var(--admin-text-primary)",
                  }}
                />
              </label>
              <label
                style={{
                  fontSize: "var(--admin-text-sm)",
                  color: "var(--admin-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--admin-space-8)",
                }}
              >
                종료일
                <input
                  aria-label="종료일"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{
                    minHeight: "38px",
                    padding: "0 var(--admin-space-12)",
                    borderRadius: "8px",
                    border: "1px solid var(--admin-border)",
                    background: "var(--admin-surface)",
                    color: "var(--admin-text-primary)",
                  }}
                />
              </label>
              <button
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
                style={{
                  minHeight: "38px",
                  padding: "0 var(--admin-space-16)",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--admin-primary)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "var(--admin-text-sm)",
                  cursor: "pointer",
                }}
              >
                조회
              </button>
            </div>
          )}

          {/* Scope 및 내부 테스트 토글 */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--admin-space-16)",
              paddingTop: "var(--admin-space-8)",
              borderTop: "1px solid var(--admin-border)",
            }}
          >
            <div
              role="group"
              aria-label="대상 범위"
              style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-8)" }}
            >
              <span
                style={{
                  fontSize: "var(--admin-text-sm)",
                  fontWeight: 600,
                  color: "var(--admin-text-secondary)",
                }}
              >
                대상:
              </span>
              {SCOPE_OPTIONS.map(([key, label]) => {
                const isSelected = scope === key;
                return (
                  <button
                    key={key}
                    onClick={() => setScope(key)}
                    aria-pressed={isSelected}
                    style={{
                      minHeight: "34px",
                      padding: "0 var(--admin-space-12)",
                      borderRadius: "8px",
                      border: `1px solid ${isSelected ? "var(--admin-primary)" : "var(--admin-border)"}`,
                      background: isSelected ? "var(--admin-focus)" : "transparent",
                      color: isSelected ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: "var(--admin-text-sm)",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-16)" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--admin-space-8)",
                  fontSize: "var(--admin-text-sm)",
                  fontWeight: 600,
                  color: "var(--admin-text-primary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={includeTestAccounts}
                  onChange={(e) => setIncludeTestAccounts(e.target.checked)}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                내부 테스트 계정 포함
              </label>
              <span style={{ fontSize: "12px", color: "var(--admin-text-secondary)" }}>
                기준: Asia/Seoul (KST)
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <AdminErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !data && isLoading ? (
          <div
            style={{
              padding: "var(--admin-space-48)",
              textAlign: "center",
              color: "var(--admin-text-secondary)",
              border: "1px solid var(--admin-border)",
              borderRadius: "16px",
              background: "var(--admin-surface)",
            }}
          >
            사용자 분석 데이터를 불러오는 중입니다...
          </div>
        ) : (
          <>
            {/* ① 가입 현황 */}
            <Section title="① 가입 현황" description="전체 등록 회원 및 선택 기간 내 활동 중인 아이 현황입니다.">
              <AdminKpiGrid>
                <AdminKpiCard
                  title="전체 가입 가족"
                  value={`${signup?.totalFamilies.toLocaleString() ?? 0}가족`}
                  description="등록된 누적 가족 계정"
                />
                <AdminKpiCard
                  title="전체 부모"
                  value={`${signup?.totalParents.toLocaleString() ?? 0}명`}
                  description="등록된 누적 부모 계정"
                />
                <AdminKpiCard
                  title="전체 아이"
                  value={`${signup?.totalChildren.toLocaleString() ?? 0}명`}
                  description="등록된 누적 아이 프로필"
                />
                <AdminKpiCard
                  title="선택기간 활성 아이"
                  value={activeChildrenFormatted.value}
                  description={activeChildrenFormatted.sub}
                />
              </AdminKpiGrid>
            </Section>

            {/* ② 핵심 사용 현황 */}
            <Section
              title="② 핵심 사용 현황"
              description="미션, 자유대화, 놀이 등 아이의 핵심 기능 이용률과 부모 리포트 열람 지표입니다."
            >
              <AdminKpiGrid>
                <AdminKpiCard
                  title="미션 사용 아이"
                  value={missionFormatted.value}
                  description={missionFormatted.sub}
                />
                <AdminKpiCard
                  title="자유대화 사용 아이"
                  value={freechatFormatted.value}
                  description={freechatFormatted.sub}
                />
                <AdminKpiCard
                  title="게임 참여 아이"
                  value={playFormatted.value}
                  description={playFormatted.sub}
                />
                <AdminKpiCard
                  title="미션 완료율"
                  value={missionCompletionFormatted.value}
                  description={missionCompletionFormatted.sub}
                />
                <AdminKpiCard
                  title="리포트 생성 가족"
                  value={reportGenFormatted.value}
                  description={reportGenFormatted.sub}
                />
                <AdminKpiCard
                  title="부모 리포트 열람 부모"
                  value={parentViewedFormatted.value}
                  description={parentViewedFormatted.sub}
                />
                <AdminKpiCard
                  title="총 열람 횟수"
                  value={`${usage?.reportViewTotal.toLocaleString() ?? 0}회`}
                  description="누적 리포트 조회 총계"
                />
                <AdminKpiCard
                  title="열람 부모 기준 평균 횟수"
                  value={
                    usage?.reportViewAvgPerViewer != null
                      ? `${usage.reportViewAvgPerViewer.toFixed(1)}회`
                      : "-"
                  }
                  description="열람한 부모 1인당 평균 조회수"
                />
              </AdminKpiGrid>
            </Section>

            {/* ③ 반복사용 현황 */}
            <Section
              title="③ 반복사용 현황"
              description="최근 7일간의 활성 일수 구간별 분포 및 30일 평균 활동일수, 가족 단위 재방문율입니다."
            >
              {/* 최근 7일 활성일수 분포 비교 카드 */}
              <div>
                <h3
                  style={{
                    fontSize: "var(--admin-text-card-title)",
                    fontWeight: 700,
                    color: "var(--admin-text-primary)",
                    marginBottom: "var(--admin-space-12)",
                  }}
                >
                  최근 7일 활성일수 분포
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "var(--admin-space-16)",
                  }}
                >
                  {(repeat?.last7Distribution ?? []).map((b) => {
                    const labelStr = distributionLabelMap[b.bucket] || b.label;
                    const color = distributionColorMap[b.bucket] || "var(--admin-primary)";
                    const countRateStr =
                      (signup?.totalChildren ?? 0) === 0 ? "-" : `${b.count}명 (${b.rate.toFixed(1)}%)`;

                    return (
                      <div
                        key={b.bucket}
                        style={{
                          background: "var(--admin-bg)",
                          border: "1px solid var(--admin-border)",
                          borderRadius: "12px",
                          padding: "var(--admin-space-16)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--admin-space-8)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "var(--admin-text-sm)",
                              fontWeight: 700,
                              color: "var(--admin-text-primary)",
                            }}
                          >
                            {labelStr}
                          </span>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color,
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background: `${color}18`,
                            }}
                          >
                            {b.rate.toFixed(1)}%
                          </span>
                        </div>

                        <div
                          style={{
                            fontSize: "20px",
                            fontWeight: 800,
                            color: "var(--admin-text-primary)",
                          }}
                        >
                          {countRateStr}
                        </div>

                        {/* Progress Bar Meter */}
                        <div
                          style={{
                            width: "100%",
                            height: "8px",
                            background: "var(--admin-border)",
                            borderRadius: "4px",
                            overflow: "hidden",
                            marginTop: "var(--admin-space-4)",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, b.rate))}%`,
                              height: "100%",
                              background: color,
                              borderRadius: "4px",
                              transition: "width 0.3s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 추가 반복 지표 카드 */}
              <AdminKpiGrid>
                <AdminKpiCard
                  title="최근 30일 평균 활성일수"
                  value={
                    repeat?.last30AvgActiveDays != null
                      ? `${repeat.last30AvgActiveDays.toFixed(1)}일`
                      : "-"
                  }
                  description="최근 30일간 아이 1인당 평균 활동 일수"
                />
                <AdminKpiCard
                  title="가족 반복사용률"
                  value={familyRepeatFormatted.value}
                  description={familyRepeatFormatted.sub}
                />
              </AdminKpiGrid>
            </Section>

            {/* ④ 사용자 상세 */}
            <Section title="④ 사용자 상세" description="아이 및 부모별 상세 활동 내역을 조회하고 정렬할 수 있습니다.">
              {/* 탭 헤더 */}
              <div
                role="tablist"
                aria-label="사용자 유형"
                style={{
                  display: "flex",
                  gap: "var(--admin-space-8)",
                  borderBottom: "1px solid var(--admin-border)",
                  paddingBottom: "var(--admin-space-12)",
                }}
              >
                <button
                  role="tab"
                  aria-selected={activeUserTab === "children"}
                  onClick={() => setActiveUserTab("children")}
                  style={{
                    padding: "var(--admin-space-8) var(--admin-space-16)",
                    borderRadius: "8px",
                    border: "none",
                    background: activeUserTab === "children" ? "var(--admin-focus)" : "transparent",
                    color:
                      activeUserTab === "children"
                        ? "var(--admin-primary)"
                        : "var(--admin-text-secondary)",
                    fontWeight: activeUserTab === "children" ? 700 : 500,
                    fontSize: "var(--admin-text-body)",
                    cursor: "pointer",
                  }}
                >
                  아이 목록 ({data?.users?.children?.length ?? 0}명)
                </button>
                <button
                  role="tab"
                  aria-selected={activeUserTab === "parents"}
                  onClick={() => setActiveUserTab("parents")}
                  style={{
                    padding: "var(--admin-space-8) var(--admin-space-16)",
                    borderRadius: "8px",
                    border: "none",
                    background: activeUserTab === "parents" ? "var(--admin-focus)" : "transparent",
                    color:
                      activeUserTab === "parents"
                        ? "var(--admin-primary)"
                        : "var(--admin-text-secondary)",
                    fontWeight: activeUserTab === "parents" ? 700 : 500,
                    fontSize: "var(--admin-text-body)",
                    cursor: "pointer",
                  }}
                >
                  부모 목록 ({data?.users?.parents?.length ?? 0}명)
                </button>
              </div>

              {/* 검색 및 정렬 필터 바 */}
              <AdminFilterBar
                searchNode={
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      activeUserTab === "children"
                        ? "아이 이름 또는 가족 ID 검색"
                        : "부모 이름 또는 가족 ID 검색"
                    }
                    style={{
                      width: "100%",
                      minHeight: "40px",
                      padding: "0 var(--admin-space-12)",
                      borderRadius: "8px",
                      border: "1px solid var(--admin-border)",
                      background: "var(--admin-surface)",
                      color: "var(--admin-text-primary)",
                      fontSize: "var(--admin-text-sm)",
                    }}
                  />
                }
                filterNodes={[
                  <select
                    key="sort-select"
                    value={activeUserTab === "children" ? childSortKey : parentSortKey}
                    onChange={(e) => {
                      if (activeUserTab === "children") {
                        setChildSortKey(e.target.value);
                      } else {
                        setParentSortKey(e.target.value);
                      }
                    }}
                    style={{
                      minHeight: "40px",
                      padding: "0 var(--admin-space-12)",
                      borderRadius: "8px",
                      border: "1px solid var(--admin-border)",
                      background: "var(--admin-surface)",
                      color: "var(--admin-text-primary)",
                      fontSize: "var(--admin-text-sm)",
                      cursor: "pointer",
                    }}
                  >
                    <option value="last_used_desc">최근 활동순</option>
                    <option value="name_asc">이름순</option>
                    <option value="joined_desc">최신 가입순</option>
                    <option value="days7_desc">최근 7일 활성순</option>
                    <option value="days30_desc">최근 30일 활성순</option>
                    {activeUserTab === "children" ? (
                      <>
                        <option value="mission_desc">미션 많은순</option>
                        <option value="freechat_desc">자유대화 많은순</option>
                        <option value="play_desc">놀이 많은순</option>
                        <option value="report_desc">리포트 많은순</option>
                      </>
                    ) : (
                      <option value="report_view_desc">리포트 열람 많은순</option>
                    )}
                  </select>,
                ]}
              />

              {/* 상세 테이블 */}
              {activeUserTab === "children" ? (
                <AdminDataTable<ChildUserRow>
                  columns={childColumns}
                  data={filteredChildren}
                  keyExtractor={(row) => row.id}
                  emptyMessage="조건에 일치하는 아이 사용자가 없습니다."
                />
              ) : (
                <AdminDataTable<ParentUserRow>
                  columns={parentColumns}
                  data={filteredParents}
                  keyExtractor={(row) => row.id}
                  emptyMessage="조건에 일치하는 부모 사용자가 없습니다."
                />
              )}
            </Section>
          </>
        )}
      </div>
    </AdminShell>
  );
}

export default function UserAnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "48px", textAlign: "center", color: "var(--admin-text-secondary)" }}>
          로딩 중...
        </div>
      }
    >
      <UserAnalyticsContent />
    </Suspense>
  );
}
