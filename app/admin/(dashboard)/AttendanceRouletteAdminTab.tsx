"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
import { ATTENDANCE_ROULETTE_LABELS, ATTENDANCE_ROULETTE_RESULTS, type AttendanceRouletteResultCode } from "@/lib/events/attendanceRoulette";

type ChildRow = {
  childId: string;
  name: string;
  username: string;
  isInternalTest: boolean;
  rank: number | null;
  score: number;
  gapFromFirst: number;
  balance: number;
  todayStatus: "NOT_STARTED" | "RETRY_AVAILABLE" | "COMPLETED";
  recentResult: AttendanceRouletteResultCode | null;
  recentResultAt: string | null;
  pendingOverride: { id: string; result_code: AttendanceRouletteResultCode; created_at: string; updated_at: string; created_by_email: string; admin_note: string | null } | null;
};

type DashboardData = {
  attendanceDate: string;
  includeTestAccounts: boolean;
  summary: {
    targetChildren: number;
    participatedChildren: number;
    notParticipatedChildren: number;
    totalKeysGranted: number;
    resultCounts: Record<AttendanceRouletteResultCode, number>;
  };
  children: ChildRow[];
  history: Array<{
    id: number;
    action: string;
    childName: string;
    actor_user_id: string | null;
    actor_email: string | null;
    override_id: string | null;
    after_state: Record<string, unknown> | null;
    created_at: string;
  }>;
};

const statusLabel = {
  NOT_STARTED: "미참여",
  RETRY_AVAILABLE: "한번 더 가능",
  COMPLETED: "참여 완료",
};

export default function AttendanceRouletteAdminTab({
  externalSearch,
  externalIncludeTestAccounts,
}: {
  externalSearch?: string;
  externalIncludeTestAccounts?: boolean;
} = {}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [localIncludeTestAccounts, setLocalIncludeTestAccounts] = useState(false);
  const includeTestAccounts = externalIncludeTestAccounts ?? localIncludeTestAccounts;
  const [selected, setSelected] = useState<Record<string, AttendanceRouletteResultCode>>({});
  const [savingChildId, setSavingChildId] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState("");
  const [historyChild, setHistoryChild] = useState("");
  const [historyResult, setHistoryResult] = useState<"" | AttendanceRouletteResultCode>("");
  const [historyAdmin, setHistoryAdmin] = useState("");
  const [historyOverride, setHistoryOverride] = useState<"" | "yes" | "no">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = includeTestAccounts ? "?includeTestAccounts=true" : "";
      const response = await fetch(`/api/admin/events/attendance-roulette${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load_failed");
      setData(await response.json());
    } catch {
      setError("출석 룰렛 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [includeTestAccounts]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!successMessage) return;
    const timeoutId = window.setTimeout(() => setSuccessMessage(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  const filtered = useMemo(() => {
    const query = [externalSearch, search].filter(Boolean).join(" ").trim().toLowerCase();
    if (!query) return data?.children ?? [];
    return (data?.children ?? []).filter((child) => child.name.toLowerCase().includes(query) || child.username.toLowerCase().includes(query));
  }, [data?.children, externalSearch, search]);

  const filteredHistory = useMemo(() => {
    const childQuery = historyChild.trim().toLowerCase();
    const adminQuery = historyAdmin.trim().toLowerCase();
    return (data?.history ?? []).filter((row) => {
      const kstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.created_at));
      if (historyDate && kstDate !== historyDate) return false;
      if (childQuery && !row.childName.toLowerCase().includes(childQuery)) return false;
      if (historyResult && row.after_state?.resultCode !== historyResult) return false;
      if (adminQuery && !`${row.actor_email ?? ""} ${row.actor_user_id ?? ""}`.toLowerCase().includes(adminQuery)) return false;
      if (historyOverride === "yes" && !row.override_id) return false;
      if (historyOverride === "no" && row.override_id) return false;
      return true;
    });
  }, [data?.history, historyAdmin, historyChild, historyDate, historyOverride, historyResult]);

  const saveOverride = async (child: ChildRow) => {
    setSuccessMessage(null);
    setSavingChildId(child.childId);
    try {
      const response = await fetch("/api/admin/events/attendance-roulette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: child.childId, resultCode: selected[child.childId] ?? "KEY_1" }),
      });
      if (!response.ok) throw new Error("save_failed");
      await load();
      setSuccessMessage("예약되었습니다. 열쇠는 지금 지급되지 않으며 다음 룰렛에 1회 적용됩니다.");
    } catch {
      setError("다음 룰렛 예약을 저장하지 못했습니다. 열쇠는 지급되지 않았습니다.");
    } finally {
      setSavingChildId(null);
    }
  };

  const cancelOverride = async (child: ChildRow) => {
    setSuccessMessage(null);
    setSavingChildId(child.childId);
    try {
      const response = await fetch("/api/admin/events/attendance-roulette", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: child.childId }),
      });
      if (!response.ok) throw new Error("cancel_failed");
      await load();
      setSuccessMessage("예약을 취소했습니다.");
    } catch {
      setError("다음 룰렛 예약을 취소하지 못했습니다.");
    } finally {
      setSavingChildId(null);
    }
  };

  if (loading && !data) return <p style={{ color: "var(--admin-text-secondary)" }}>출석 룰렛 현황을 불러오는 중입니다…</p>;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>출석 룰렛 운영 · 현재 보유 열쇠와 다음 결과 예약</h2>
        <p style={{ color: "var(--admin-text-secondary)", fontSize: 13 }}>KST {data?.attendanceDate} · 기본 확률 +1 80% / 한번 더 20%</p>
        <p style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--admin-border)", color: "var(--admin-text-secondary)", fontSize: 13 }}>
          다음 룰렛 결과를 1회 예약합니다. 저장해도 열쇠는 즉시 지급되지 않으며, 아이가 다음 룰렛을 실제로 돌릴 때 적용됩니다.
        </p>
      </div>
      {error && <div role="alert" style={{ padding: 12, borderRadius: 10, background: "#fee2e2", color: "#991b1b" }}>{error} <button onClick={() => void load()} style={{ marginLeft: 8, fontWeight: 800, textDecoration: "underline" }}>다시 시도</button></div>}
      {successMessage && <div role="status" style={{ padding: 12, borderRadius: 10, background: "#dcfce7", color: "#166534" }}>{successMessage}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[
          ["대상 아이", data?.summary.targetChildren ?? 0],
          ["오늘 참여", data?.summary.participatedChildren ?? 0],
          ["오늘 미참여", data?.summary.notParticipatedChildren ?? 0],
          ["오늘 지급 열쇠", data?.summary.totalKeysGranted ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} style={{ padding: 16, border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>
            <div style={{ fontSize: 12, color: "var(--admin-text-secondary)" }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: 14, border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>
        <strong style={{ display: "block", marginBottom: 8 }}>오늘 결과별 횟수</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ATTENDANCE_ROULETTE_RESULTS.map((code) => (
            <span key={code} style={{ padding: "5px 9px", borderRadius: 999, background: "var(--admin-focus)", fontSize: 12 }}>
              {ATTENDANCE_ROULETTE_LABELS[code]} {data?.summary.resultCounts[code] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 17, fontWeight: 800 }}>아이별 운영</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름 또는 로그인 ID 검색" style={{ minWidth: 260, padding: "9px 12px", border: "1px solid var(--admin-border)", borderRadius: 8 }} />
            {externalIncludeTestAccounts === undefined && <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeTestAccounts}
                disabled={loading}
                onChange={(event) => setLocalIncludeTestAccounts(event.target.checked)}
              />
              내부 테스트 계정 포함
            </label>}
            {loading && data && <span role="status" style={{ color: "var(--admin-text-secondary)", fontSize: 12 }}>필터 적용 중…</span>}
          </div>
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--admin-border)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120, fontSize: 13 }}>
            <thead style={{ background: "var(--admin-focus)" }}><tr>
              {["순위", "아이", "월 점수", "1등과 차이", "현재 보유 열쇠(잔여)", "오늘 룰렛", "최근 실행 결과", "다음 룰렛 예약", "예약 설정"].map((label) => <th key={label} style={{ padding: 10, textAlign: "left" }}>{label}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map((child) => (
                <tr key={child.childId} style={{ borderTop: "1px solid var(--admin-border)" }}>
                  <td style={{ padding: 10 }}>{child.rank ?? "-"}</td>
                  <td style={{ padding: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <strong>{child.name}</strong>
                      {child.isInternalTest && <AdminStatusBadge variant="neutral" text="[테스트]" icon={false} />}
                    </span>
                    <br/><span style={{ color: "var(--admin-text-secondary)" }}>{child.username || "아이디 없음"}</span>
                  </td>
                  <td style={{ padding: 10 }}>{child.score}</td>
                  <td style={{ padding: 10 }}>{child.gapFromFirst}</td>
                  <td style={{ padding: 10 }}>
                    <strong>{child.balance}</strong>
                    <br/><span style={{ color: "var(--admin-text-secondary)", fontSize: 11 }}>미소비 열쇠 잔여</span>
                  </td>
                  <td style={{ padding: 10 }}>{statusLabel[child.todayStatus]}</td>
                  <td style={{ padding: 10 }}>
                    {child.recentResult ? <><strong>{ATTENDANCE_ROULETTE_LABELS[child.recentResult]}</strong><br/><span style={{ color: "var(--admin-text-secondary)", fontSize: 11 }}>실행 완료 · {child.recentResultAt ? new Date(child.recentResultAt).toLocaleString("ko-KR") : "시간 정보 없음"}</span></> : <span style={{ color: "var(--admin-text-secondary)" }}>실행 이력 없음</span>}
                  </td>
                  <td style={{ padding: 10 }}>
                    {child.pendingOverride ? <><strong>예약됨 · {ATTENDANCE_ROULETTE_LABELS[child.pendingOverride.result_code]}</strong><br/><span style={{ color: "var(--admin-text-secondary)", fontSize: 11 }}>다음 실제 룰렛 1회에 적용</span><br/><span style={{ color: "var(--admin-text-secondary)", fontSize: 11 }}>{new Date(child.pendingOverride.updated_at).toLocaleString("ko-KR")} · {child.pendingOverride.created_by_email}</span></> : <><strong>예약 없음</strong><br/><span style={{ color: "var(--admin-text-secondary)", fontSize: 11 }}>다음 룰렛은 기본 확률 적용</span></>}
                  </td>
                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={selected[child.childId] ?? child.pendingOverride?.result_code ?? "KEY_1"} onChange={(event) => setSelected((current) => ({ ...current, [child.childId]: event.target.value as AttendanceRouletteResultCode }))} style={{ padding: 7, borderRadius: 7, border: "1px solid var(--admin-border)" }}>
                        {ATTENDANCE_ROULETTE_RESULTS.map((code) => <option key={code} value={code}>{ATTENDANCE_ROULETTE_LABELS[code]}</option>)}
                      </select>
                      <button disabled={savingChildId === child.childId} onClick={() => void saveOverride(child)} style={{ padding: "7px 10px", borderRadius: 7, background: "var(--admin-primary)", color: "white", fontWeight: 700 }}>다음 결과 예약</button>
                      {child.pendingOverride && <button disabled={savingChildId === child.childId} onClick={() => void cancelOverride(child)} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--admin-border)" }}>예약 취소</button>}
                    </div>
                    <p style={{ marginTop: 6, color: "var(--admin-text-secondary)", fontSize: 11, lineHeight: 1.4 }}>
                      저장 시 선택한 결과가 다음 실제 룰렛 스핀에 1회 강제 적용됩니다. 저장 직후에는 열쇠가 지급되지 않습니다.
                      {child.todayStatus === "COMPLETED" && <><br/>오늘 룰렛은 이미 사용했습니다. 예약 결과는 다음 참여 가능한 룰렛에 적용됩니다.</>}
                    </p>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--admin-text-secondary)" }}>조건에 맞는 아이가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>최근 감사 이력</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} aria-label="이력 날짜" style={{ padding: 8, border: "1px solid var(--admin-border)", borderRadius: 7 }} />
          <input value={historyChild} onChange={(event) => setHistoryChild(event.target.value)} placeholder="아이 이름" aria-label="이력 아이 필터" style={{ padding: 8, border: "1px solid var(--admin-border)", borderRadius: 7 }} />
          <select value={historyResult} onChange={(event) => setHistoryResult(event.target.value as "" | AttendanceRouletteResultCode)} aria-label="이력 결과 필터" style={{ padding: 8, border: "1px solid var(--admin-border)", borderRadius: 7 }}>
            <option value="">모든 결과</option>
            {ATTENDANCE_ROULETTE_RESULTS.map((code) => <option key={code} value={code}>{ATTENDANCE_ROULETTE_LABELS[code]}</option>)}
          </select>
          <input value={historyAdmin} onChange={(event) => setHistoryAdmin(event.target.value)} placeholder="관리자 이메일 또는 ID" aria-label="이력 관리자 필터" style={{ padding: 8, border: "1px solid var(--admin-border)", borderRadius: 7 }} />
          <select value={historyOverride} onChange={(event) => setHistoryOverride(event.target.value as "" | "yes" | "no")} aria-label="override 사용 필터" style={{ padding: 8, border: "1px solid var(--admin-border)", borderRadius: 7 }}>
            <option value="">override 전체</option><option value="yes">override 사용</option><option value="no">기본 확률</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {filteredHistory.slice(0, 30).map((row) => (
            <div key={row.id} style={{ padding: 10, border: "1px solid var(--admin-border)", borderRadius: 8, fontSize: 12 }}>
              <strong>{row.childName}</strong> · {row.action}
              {row.after_state?.resultCode ? ` · ${String(row.after_state.resultCode)}` : ""}
              {row.actor_email ? ` · 관리자 ${row.actor_email}` : row.actor_user_id ? " · 관리자 확인 불가" : ""}
              {row.override_id ? " · override" : ""} · {new Date(row.created_at).toLocaleString("ko-KR")}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
