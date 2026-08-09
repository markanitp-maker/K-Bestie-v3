"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";

type MissionProgressDisplay = {
  started: boolean;
  validTurns: number;
  targetTurns: number;
  completed: boolean;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

export default function ManualReportingTab() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA")); // YYYY-MM-DD
  const [scope, setScope] = useState<"single" | "all">("single");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed" | "pending">("all");
  const [children, setChildren] = useState<any[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const [summary, setSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  const runAbortControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      runAbortControllerRef.current?.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const loadChildren = useCallback(() => {
    if (scope !== "single") return;
    setLoadingChildren(true);
    fetch(`/api/admin/reporting/children?businessDate=${date}&search=${encodeURIComponent(search)}`)
      .then(r => r.json())
      .then(d => {
        setChildren(d.children || []);
        if (!d.children?.find((c: any) => c.childId === selectedChildId)) {
          setSelectedChildId(null);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingChildren(false));
  }, [date, search, scope, selectedChildId]);

  useEffect(() => {
    if (scope === "single") {
      const timer = setTimeout(() => {
        loadChildren();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [date, search, scope, loadChildren]);

  const loadSummary = useCallback(() => {
    if (scope !== "all") return;
    setLoadingSummary(true);
    fetch(`/api/admin/reporting/summary?businessDate=${date}`)
      .then(r => r.json())
      .then(d => {
        setSummary(d);
      })
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [date, scope]);

  useEffect(() => {
    if (scope === "all") {
      loadSummary();
    }
  }, [date, scope, loadSummary]);

  const handleRun = async (action: "collect_first" | "collect_second" | "collect_all" | "generate" | "collect_and_generate") => {
    if (scope === "all") {
      if (!window.confirm("전체 아이를 대상으로 실행하시겠습니까? 시간이 오래 걸릴 수 있습니다.")) return;
    }

    setRunning(true);
    setRunResult(null);

    if (runAbortControllerRef.current) runAbortControllerRef.current.abort();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    
    const controller = new AbortController();
    runAbortControllerRef.current = controller;

    try {
      const fetchWithTimeout = async (url: string, options: RequestInit, ms: number = 30000) => {
        const timeoutController = new AbortController();
        let isTimeout = false;
        const id = setTimeout(() => {
          isTimeout = true;
          timeoutController.abort();
        }, ms);
        
        const onParentAbort = () => timeoutController.abort();
        controller.signal.addEventListener("abort", onParentAbort);
        
        try {
          const res = await fetch(url, { ...options, signal: timeoutController.signal });
          return res;
        } catch (e: any) {
          if (isTimeout) throw new Error("Request timed out");
          throw e;
        } finally {
          clearTimeout(id);
          controller.signal.removeEventListener("abort", onParentAbort);
        }
      };

      const target = scope === "single"
        ? { scope: "single", childId: selectedChildId }
        : { scope: "all" };

      const res = await fetchWithTimeout("/api/admin/reporting/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDate: date, action, target })
      });

      const data = await res.json();
      if (controller.signal.aborted) return;
      
      if (data.v3 && data.execution_id) {
        if (data.completed) {
          setRunResult(data);
          setRunning(false);
          return;
        }

        const executionId = data.execution_id;
        const targetCount = data.targetCount ?? (scope === "single" ? 1 : 0);
        
        let errorCount = 0;
        const startTime = Date.now();
        const MAX_TIME = 10 * 60 * 1000;

        const poll = async () => {
          if (controller.signal.aborted) return;
          if (Date.now() - startTime > MAX_TIME) {
            setRunResult({ ok: false, error: "Polling timed out after 10 minutes." });
            setRunning(false);
            return;
          }
          if (errorCount >= 5) {
            setRunResult({ ok: false, error: "Too many polling failures. Please check server logs." });
            setRunning(false);
            return;
          }

          try {
            const statusRes = await fetchWithTimeout("/api/admin/reporting/pulse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ executionId, action, targetCount }),
            });
            const statusData = await statusRes.json();
            
            if (controller.signal.aborted) return;

            if (statusData.ok) {
              errorCount = 0;
              setRunResult({
                ...data,
                partialFailure: statusData.partialFailure,
                statuses: statusData.statuses,
                memory: statusData.summary?.memory || data.memory,
                report: statusData.summary?.report || data.report
              });
              
              if (statusData.isComplete) {
                setRunning(false);
                loadSummary();
                return;
              }
            } else {
              errorCount++;
            }
          } catch (e: any) {
            if (e.name === 'AbortError') return;
            console.error("Poll error", e);
            errorCount++;
          }
          if (!controller.signal.aborted) {
            pollTimerRef.current = setTimeout(poll, 2000);
          }
        };
        pollTimerRef.current = setTimeout(poll, 2000);
      } else {
        setRunResult(data);
        if (data.ok) {
          if (scope === "single") loadChildren();
          if (scope === "all") loadSummary();
        }
        setRunning(false);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setRunResult({ ok: false, error: e.message });
      setRunning(false);
    }
  };

  const selectedChild = children.find(c => c.childId === selectedChildId);

  const filteredChildren = children.filter((c) => {
    if (statusFilter === "all") return true;

    const jobStatuses = [
      c.jobs?.collection_1?.status,
      c.jobs?.collection_2?.status,
      c.jobs?.context_correction?.status,
      c.jobs?.memory_batch?.status,
      c.jobs?.daily_report?.status,
    ];

    const hasFailed = jobStatuses.some(s => s === "failed");
    const hasPending = jobStatuses.some(s => s !== "completed");

    if (statusFilter === "success") return !hasPending;
    if (statusFilter === "failed") return hasFailed;
    if (statusFilter === "pending") return !hasFailed && hasPending;
    return true;
  });

  const getStatusUI = (job: any, count: number, isCollection: boolean = false) => {
    if (!job) return <span style={{ color: "var(--admin-text-secondary)" }}>대기</span>;
    let color = "var(--admin-text-secondary)";
    let text = "대기";
    
    if (job.status === "completed") {
      color = "var(--admin-success)";
      text = "완료";
    } else if (job.status === "processing" || job.status === "claimed") {
      color = "var(--admin-primary)";
      text = "실행 중";
    } else if (job.status === "failed") {
      color = "var(--admin-danger)";
      text = "실패";
    } else if (job.status === "retry_wait") {
      color = "var(--admin-warning)";
      text = "재시도 대기";
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ color, fontWeight: 600, fontSize: "var(--admin-text-sm)" }}>
          {text}{isCollection && job.status === "completed" ? ` · ${count}건` : ""}
        </div>
        {job.completed_at ? (
          <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>
            {formatDateTime(job.completed_at).substring(11, 19)}
          </div>
        ) : job.started_at ? (
          <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>
            시작: {formatDateTime(job.started_at).substring(11, 19)}
          </div>
        ) : null}
      </div>
    );
  };

  const formatMissionProgress = (mission?: MissionProgressDisplay) => {
    if (!mission?.started) return <span style={{ color: "var(--admin-text-secondary)" }}>미시작</span>;
    const validTurns = Math.min(mission.validTurns ?? 0, mission.targetTurns ?? 10);
    const targetTurns = mission.targetTurns ?? 10;
    const completed = mission.completed || validTurns >= targetTurns;
    const status = completed ? "완료" : validTurns === 0 ? "시작만" : "미완료";
    const color = completed ? "var(--admin-success)" : validTurns === 0 ? "var(--admin-text-secondary)" : "var(--admin-warning)";

    return <span style={{ color, fontWeight: 600 }}>{validTurns}/{targetTurns} {status}</span>;
  };

  const formatMessageCount = (count?: number) => `${count ?? 0}건`;

  const columns: AdminDataTableColumn<any>[] = [
    { key: "select", header: "선택", render: (c) => (
      <input type="radio" checked={selectedChildId === c.childId} readOnly style={{ cursor: "pointer" }} />
    )},
    { key: "name", header: "이름", render: (c) => c.name },
    { key: "mission1Progress", header: "미션1 진행", render: (c) => formatMissionProgress(c.mission1) },
    { key: "mission1Saved", header: "미션1 저장", render: (c) => formatMessageCount(c.mission1?.savedMessageCount) },
    { key: "mission1Collected", header: "1차 수집", render: (c) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span>{formatMessageCount(c.mission1?.collectedMessageCount)}</span>
        {getStatusUI(c.jobs?.collection_1, c.mission1?.collectedMessageCount ?? 0, false)}
      </div>
    ) },
    { key: "mission2Progress", header: "미션2 진행", render: (c) => formatMissionProgress(c.mission2) },
    { key: "mission2Saved", header: "미션2 저장", render: (c) => formatMessageCount(c.mission2?.savedMessageCount) },
    { key: "mission2Collected", header: "2차 수집", render: (c) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span>{formatMessageCount(c.mission2?.collectedMessageCount)}</span>
        {getStatusUI(c.jobs?.collection_2, c.mission2?.collectedMessageCount ?? 0, false)}
      </div>
    ) },
    { key: "freeChat", header: "자유대화", render: (c) => `${c.freeChatSessionCount}회` },
    { key: "corr", header: "보정", render: (c) => getStatusUI(c.jobs?.context_correction, 0) },
    { key: "mem", header: "Memory Batch", render: (c) => getStatusUI(c.jobs?.memory_batch, 0) },
    { key: "report", header: "리포트", render: (c) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {getStatusUI(c.jobs?.daily_report, 0)}
        {c.reportExists && (c.generationSource || c.generationVersion) && (
          <span style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>
            {c.generationSource === "scheduled" ? "정기" : "수동"} (v{c.generationVersion || 1})
          </span>
        )}
      </div>
    )}
  ];

  const resultColumns: AdminDataTableColumn<any>[] = [
    { key: "child", header: "아이", render: (s) => {
      if (s.isDeleted) return <span style={{ color: "var(--admin-text-secondary)", fontStyle: "italic" }}>삭제된 아이 ({s.maskedChildId})</span>;
      if (s.childName && s.loginId) return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{s.childName}</span>
          <span style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", wordBreak: "break-all" }}>{s.loginId}</span>
        </div>
      );
      if (s.childName) return <span style={{ fontWeight: 600 }}>{s.childName}</span>;
      if (s.loginId) return <span style={{ wordBreak: "break-all" }}>{s.loginId}</span>;
      return <span style={{ color: "var(--admin-text-secondary)" }}>{s.maskedChildId}</span>;
    }},
    { key: "collection", header: "수집", render: (s) => (
      <>
        {s.collection2 || s.collection || "-"}
        {s.collectionError && <div style={{ color: "var(--admin-danger)", fontSize: "var(--admin-text-xs)" }}>{s.collectionError}</div>}
      </>
    )},
    { key: "correction", header: "수집보정", render: (s) => (
      <>
        {s.correction || "-"}
        {s.correctionError && <div style={{ color: "var(--admin-danger)", fontSize: "var(--admin-text-xs)" }}>{s.correctionError}</div>}
      </>
    )},
    { key: "memory", header: "메모리", render: (s) => (
      <>
        {s.memory || "-"}
        {s.memoryError && <div style={{ color: "var(--admin-danger)", fontSize: "var(--admin-text-xs)" }}>{s.memoryError}</div>}
      </>
    )},
    { key: "report", header: "리포트", render: (s) => (
      <>
        {s.report || "-"}
        {s.reportError && <div style={{ color: "var(--admin-danger)", fontSize: "var(--admin-text-xs)" }}>{s.reportError}</div>}
        {(s.generationSource || s.generationVersion) && (
          <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: "var(--admin-space-4)" }}>
            <div>생성: {s.lastReportGeneratedAt ? formatDateTime(s.lastReportGeneratedAt).substring(0, 16) : "-"}</div>
            <div>방식: {s.generationSource === "scheduled" ? "정기 생성" : "수동 생성"}</div>
            <div>버전: v{s.generationVersion || 1}</div>
          </div>
        )}
      </>
    )}
  ];

  return (
    <div style={{ width: "100%" }}>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        리포팅 수동 실행
      </h2>
      
      <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "var(--admin-space-16)", marginBottom: "var(--admin-space-20)" }}>
        <div style={{ display: "flex", gap: "var(--admin-space-16)", alignItems: "center", marginBottom: "var(--admin-space-16)" }}>
          <label style={{ fontSize: "var(--admin-text-sm)", fontWeight: 600 }}>대상 날짜</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ padding: "var(--admin-space-6) var(--admin-space-10)", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-sm)", background: "var(--admin-bg)", color: "var(--admin-text-primary)" }}
          />
        </div>
        
        <div style={{ display: "flex", gap: "var(--admin-space-16)", alignItems: "center" }}>
          <label style={{ fontSize: "var(--admin-text-sm)", fontWeight: 600 }}>실행 대상</label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-4)", fontSize: "var(--admin-text-sm)", cursor: "pointer", color: "var(--admin-text-primary)" }}>
            <input type="radio" name="scope" checked={scope === "single"} onChange={() => setScope("single")} />
            특정 아이 1명
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-4)", fontSize: "var(--admin-text-sm)", cursor: "pointer", color: "var(--admin-text-primary)" }}>
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
            전체 아이
          </label>
        </div>
      </div>

      {scope === "single" && (
        <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "var(--admin-space-16)", marginBottom: "var(--admin-space-20)" }}>
          <div style={{ display: "flex", gap: "var(--admin-space-16)", alignItems: "center", marginBottom: "var(--admin-space-16)", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="이름 또는 ID로 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "var(--admin-space-8) var(--admin-space-12)", borderRadius: 8, border: "1px solid var(--admin-border)", width: "100%", maxWidth: 300, fontSize: "var(--admin-text-sm)", background: "var(--admin-bg)", color: "var(--admin-text-primary)" }}
            />
            <div style={{ display: "flex", gap: "var(--admin-space-8)" }}>
              {(["all", "success", "failed", "pending"] as const).map(filter => {
                const label = filter === "all" ? "전체" : filter === "success" ? "성공" : filter === "failed" ? "실패" : "대기";
                const isSelected = statusFilter === filter;
                return (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    style={{
                      padding: "var(--admin-space-4) var(--admin-space-12)",
                      borderRadius: 16,
                      fontSize: "var(--admin-text-xs)",
                      fontWeight: 600,
                      background: isSelected ? "var(--admin-primary)" : "var(--admin-bg)",
                      color: isSelected ? "white" : "var(--admin-text-primary)",
                      border: `1px solid ${isSelected ? "var(--admin-primary)" : "var(--admin-border)"}`,
                      cursor: "pointer"
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: "var(--admin-space-16)" }}>
            <AdminResponsiveTable mobileStrategy="card"
              columns={columns}
              data={filteredChildren}
              isLoading={loadingChildren}
              keyExtractor={(c) => c.childId || Math.random().toString()}
              emptyMessage={search ? "검색 결과가 없습니다." : "아이를 검색해주세요."}
              onRowClick={(c) => setSelectedChildId(c.childId)}
              expandedRowIds={selectedChildId ? new Set([selectedChildId]) : new Set()}
            />
          </div>

          <div style={{ display: "flex", gap: "var(--admin-space-8)" }}>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect_first")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-bg)", border: "1px solid var(--admin-primary)", color: "var(--admin-primary)", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              1차 수집 실행
            </button>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect_second")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-bg)", border: "1px solid var(--admin-primary)", color: "var(--admin-primary)", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              2차 수집 실행
            </button>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect_all")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-bg)", border: "1px solid var(--admin-primary)", color: "var(--admin-primary)", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              전체 수집 실행
            </button>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect_and_generate")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-primary)", border: "none", color: "white", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              수집 후 리포트 즉시 생성
            </button>
          </div>
        </div>
      )}

      {scope === "all" && (
        <div style={{ background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", padding: "var(--admin-space-16)", marginBottom: "var(--admin-space-20)" }}>
          {loadingSummary && !summary ? (
            <div style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-text-secondary)" }}>요약 정보 불러오는 중...</div>
          ) : summary ? (
            <div style={{ marginBottom: "var(--admin-space-16)" }}>
              <AdminKpiGrid>
                <AdminKpiCard title="가입 전체 아이" value={`${summary.totalChildren}명`} />
                <AdminKpiCard title="수집된 대화 있음" value={`${summary.hasValidConversation}명`} />
                <AdminKpiCard title="리포트 존재" value={`${summary.reportExists}명`} />
                <AdminKpiCard 
                  title="대화O 리포트X (누락)" 
                  value={<span style={{ color: summary.reportMissing > 0 ? "var(--admin-danger)" : "inherit" }}>{summary.reportMissing}명</span>} 
                />
              </AdminKpiGrid>
            </div>
          ) : (
            <div style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-danger)" }}>요약 정보 로드 실패</div>
          )}

          <div style={{ display: "flex", gap: "var(--admin-space-8)" }}>
            <button
              disabled={running}
              onClick={() => handleRun("collect_all")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-bg)", border: "1px solid var(--admin-primary)", color: "var(--admin-primary)", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 대화 수집
            </button>
            <button
              disabled={running}
              onClick={() => handleRun("generate")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-bg)", border: "1px solid var(--admin-primary)", color: "var(--admin-primary)", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 리포트 생성
            </button>
            <button
              disabled={running}
              onClick={() => handleRun("collect_and_generate")}
              style={{ padding: "var(--admin-space-8) var(--admin-space-16)", borderRadius: 8, background: "var(--admin-primary)", border: "none", color: "white", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 수집 후 생성
            </button>
          </div>
        </div>
      )}

      {/* 실행 결과 표시 */}
      {(running || runResult) && (
        <div style={{ background: "var(--admin-focus)", borderRadius: 12, padding: "var(--admin-space-16)", border: "1px solid var(--admin-border)" }}>
          <div style={{ fontSize: "var(--admin-text-sm)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-8)" }}>
            실행 결과
          </div>
          {running ? (
            <div style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-text-secondary)" }}>실행 중입니다. 잠시만 기다려 주세요...</div>
          ) : runResult ? (
            <div style={{ fontSize: "var(--admin-text-sm)", whiteSpace: "pre-wrap", background: "var(--admin-bg)", padding: "var(--admin-space-12)", borderRadius: 8, border: "1px solid var(--admin-border)", color: "var(--admin-text-primary)" }}>
              {!runResult.ok ? (
                <div style={{ color: "var(--admin-danger)", fontWeight: 600 }}>에러: {runResult.error}</div>
              ) : (
                <>
                  <div style={{ marginBottom: "var(--admin-space-8)" }}>
                    {runResult.partialFailure ? (
                      <strong style={{ color: "var(--admin-danger)" }}>⚠️ 일부 실패</strong>
                    ) : (
                      <strong style={{ color: "var(--admin-success)" }}>✅ 성공</strong>
                    )}
                    {" "}(동작: {runResult.action})
                    {runResult.partialFailure && (
                      <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-danger)", marginTop: "var(--admin-space-4)" }}>
                        아래 수집/생성 에러 목록을 확인하세요 - 일부 세션·아이는 처리되지 않았을 수 있습니다.
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: "var(--admin-space-8)" }}>
                    <strong style={{ fontWeight: "var(--admin-weight-bold)" }}>[Memory Batch]</strong><br/>
                    - 성공: {runResult.memory?.success ?? 0}명<br/>
                    - 건너뜀: {runResult.memory?.skipped ?? 0}명<br/>
                    - 실패: {runResult.memory?.failed ?? 0}명
                  </div>
                  <div style={{ marginBottom: "var(--admin-space-8)" }}>
                    <strong style={{ fontWeight: "var(--admin-weight-bold)" }}>[리포트 생성]</strong><br/>
                    - 생성/갱신: {runResult.report?.created ?? 0}건<br/>
                    - 건너뜀(대화 없음): {runResult.report?.skipped ?? 0}건<br/>
                    - 에러: {runResult.report?.failed ?? 0}건
                  </div>
                  {runResult.v3 && runResult.statuses && (
                    <div style={{ marginTop: "var(--admin-space-12)" }}>
                      <strong style={{ fontWeight: "var(--admin-weight-bold)" }}>[V3 처리 상태]</strong><br/>
                      <div style={{ marginTop: "var(--admin-space-8)" }}>
                        <AdminResponsiveTable mobileStrategy="card"
                          columns={resultColumns}
                          data={runResult.statuses}
                          keyExtractor={(s: any) => s.childId || s.maskedChildId || s.loginId || Math.random().toString()}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
