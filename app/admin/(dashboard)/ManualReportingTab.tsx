"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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

export default function ManualReportingTab() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA")); // YYYY-MM-DD
  const [scope, setScope] = useState<"single" | "all">("single");
  const [search, setSearch] = useState("");
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

  const handleRun = async (action: "collect" | "generate" | "collect_and_generate") => {
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

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", margin: "24px 0 10px" }}>
        리포팅 수동 실행
      </div>
      
      <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>대상 날짜</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13 }}
          />
        </div>
        
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>실행 대상</label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
            <input type="radio" name="scope" checked={scope === "single"} onChange={() => setScope("single")} />
            특정 아이 1명
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
            전체 아이
          </label>
        </div>
      </div>

      {scope === "single" && (
        <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16, marginBottom: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="이름 또는 ID로 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-k-border)", width: "100%", maxWidth: 300, fontSize: 13 }}
            />
          </div>

          <div style={{ overflowX: "auto", maxHeight: 300, border: "1px solid var(--color-k-border)", borderRadius: 8, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--color-k-background)" }}>
                <tr>
                  <th style={thStyle}>선택</th>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>세션 (미션/자유)</th>
                  <th style={thStyle}>대화수집</th>
                  <th style={thStyle}>리포트(생성/버전)</th>
                  <th style={thStyle}>N/8</th>
                </tr>
              </thead>
              <tbody>
                {loadingChildren && children.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>검색 중...</td></tr>
                ) : children.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>결과가 없습니다.</td></tr>
                ) : (
                  children.map(c => (
                    <tr key={c.childId} onClick={() => setSelectedChildId(c.childId)} style={{ cursor: "pointer", background: selectedChildId === c.childId ? "var(--color-k-navy-tint)" : undefined }}>
                      <td style={tdStyle}>
                        <input type="radio" checked={selectedChildId === c.childId} readOnly />
                      </td>
                      <td style={tdStyle}>{c.name}</td>
                      <td style={tdStyle}>{c.missionSessionCount} / {c.freeChatSessionCount}</td>
                      <td style={tdStyle}>{c.collected ? "O" : "X"}</td>
                      <td style={tdStyle}>
                        {c.reportExists ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span>{c.lastReportGeneratedAt ? formatDateTime(c.lastReportGeneratedAt).substring(0, 16) : "O"}</span>
                            {(c.generationSource || c.generationVersion) && (
                              <span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>
                                {c.generationSource === "scheduled" ? "정기" : "수동"} (v{c.generationVersion || 1})
                              </span>
                            )}
                          </div>
                        ) : "X"}
                      </td>
                      <td style={tdStyle}>{c.dashboardFieldCount ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "white", border: "1px solid var(--color-k-navy)", color: "var(--color-k-navy)", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              즉시 대화 수집
            </button>
            <button
              disabled={!selectedChildId || running || !selectedChild?.collected}
              onClick={() => handleRun("generate")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "white", border: "1px solid var(--color-k-navy)", color: "var(--color-k-navy)", fontWeight: 600, cursor: (!selectedChildId || running || !selectedChild?.collected) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running || !selectedChild?.collected) ? 0.5 : 1 }}
            >
              즉시 리포트 생성
            </button>
            <button
              disabled={!selectedChildId || running}
              onClick={() => handleRun("collect_and_generate")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "var(--color-k-navy)", border: "none", color: "white", fontWeight: 600, cursor: (!selectedChildId || running) ? "not-allowed" : "pointer", opacity: (!selectedChildId || running) ? 0.5 : 1 }}
            >
              수집 후 리포트 즉시 생성
            </button>
          </div>
        </div>
      )}

      {scope === "all" && (
        <div style={{ background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)", padding: 16, marginBottom: 20 }}>
          {loadingSummary && !summary ? (
            <div style={{ fontSize: 13 }}>요약 정보 불러오는 중...</div>
          ) : summary ? (
            <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ background: "var(--color-k-surface)", padding: 12, borderRadius: 8, minWidth: 120 }}>
                <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>가입 전체 아이</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{summary.totalChildren}명</div>
              </div>
              <div style={{ background: "var(--color-k-surface)", padding: 12, borderRadius: 8, minWidth: 120 }}>
                <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>수집된 대화 있음</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{summary.hasValidConversation}명</div>
              </div>
              <div style={{ background: "var(--color-k-surface)", padding: 12, borderRadius: 8, minWidth: 120 }}>
                <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>리포트 존재</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{summary.reportExists}명</div>
              </div>
              <div style={{ background: "var(--color-k-surface)", padding: 12, borderRadius: 8, minWidth: 120, borderLeft: summary.reportMissing > 0 ? "4px solid var(--color-k-danger)" : undefined }}>
                <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)" }}>대화O 리포트X (누락)</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: summary.reportMissing > 0 ? "var(--color-k-danger)" : undefined }}>{summary.reportMissing}명</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--color-k-danger)" }}>요약 정보 로드 실패</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={running}
              onClick={() => handleRun("collect")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "white", border: "1px solid var(--color-k-navy)", color: "var(--color-k-navy)", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 대화 수집
            </button>
            <button
              disabled={running}
              onClick={() => handleRun("generate")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "white", border: "1px solid var(--color-k-navy)", color: "var(--color-k-navy)", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 리포트 생성
            </button>
            <button
              disabled={running}
              onClick={() => handleRun("collect_and_generate")}
              style={{ padding: "8px 16px", borderRadius: 8, background: "var(--color-k-navy)", border: "none", color: "white", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              전체 수집 후 생성
            </button>
          </div>
        </div>
      )}

      {/* 실행 결과 표시 */}
      {(running || runResult) && (
        <div style={{ background: "var(--color-k-navy-tint)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-navy)", marginBottom: 8 }}>
            실행 결과
          </div>
          {running ? (
            <div style={{ fontSize: 13 }}>실행 중입니다. 잠시만 기다려 주세요...</div>
          ) : runResult ? (
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap", background: "white", padding: 12, borderRadius: 8, border: "1px solid var(--color-k-border)" }}>
              {!runResult.ok ? (
                <div style={{ color: "var(--color-k-danger)", fontWeight: 600 }}>에러: {runResult.error}</div>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}>
                    {runResult.partialFailure ? (
                      <strong style={{ color: "var(--color-k-danger)" }}>⚠️ 일부 실패</strong>
                    ) : (
                      <strong>✅ 성공</strong>
                    )}
                    {" "}(동작: {runResult.action})
                    {runResult.partialFailure && (
                      <div style={{ fontSize: 12, color: "var(--color-k-danger)", marginTop: 4 }}>
                        아래 수집/생성 에러 목록을 확인하세요 - 일부 세션·아이는 처리되지 않았을 수 있습니다.
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>[Memory Batch]</strong><br/>
                    - 성공: {runResult.memory?.success ?? 0}명<br/>
                    - 건너뜀: {runResult.memory?.skipped ?? 0}명<br/>
                    - 실패: {runResult.memory?.failed ?? 0}명
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>[리포트 생성]</strong><br/>
                    - 생성/갱신: {runResult.report?.created ?? 0}건<br/>
                    - 건너뜀(대화 없음): {runResult.report?.skipped ?? 0}건<br/>
                    - 에러: {runResult.report?.failed ?? 0}건
                  </div>
                  {runResult.v3 && runResult.statuses && (
                    <div style={{ marginTop: 12 }}>
                      <strong>[V3 처리 상태]</strong><br/>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>아이 ID</th>
                            <th style={thStyle}>수집</th>
                            <th style={thStyle}>수집보정</th>
                            <th style={thStyle}>메모리</th>
                            <th style={thStyle}>리포트</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runResult.statuses.map((s: any, i: number) => (
                            <tr key={i}>
                              <td style={tdStyle}>{s.childId.substring(0, 8)}...</td>
                              <td style={tdStyle}>
                                {s.collection2 || s.collection || "-"}
                                {s.collectionError && <div style={{ color: "var(--color-k-danger)", fontSize: 11 }}>{s.collectionError}</div>}
                              </td>
                              <td style={tdStyle}>
                                {s.correction || "-"}
                                {s.correctionError && <div style={{ color: "var(--color-k-danger)", fontSize: 11 }}>{s.correctionError}</div>}
                              </td>
                              <td style={tdStyle}>
                                {s.memory || "-"}
                                {s.memoryError && <div style={{ color: "var(--color-k-danger)", fontSize: 11 }}>{s.memoryError}</div>}
                              </td>
                              <td style={tdStyle}>
                                {s.report || "-"}
                                {s.reportError && <div style={{ color: "var(--color-k-danger)", fontSize: 11 }}>{s.reportError}</div>}
                                {(s.generationSource || s.generationVersion) && (
                                  <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 4 }}>
                                    <div>생성: {s.lastReportGeneratedAt ? formatDateTime(s.lastReportGeneratedAt).substring(0, 16) : "-"}</div>
                                    <div>방식: {s.generationSource === "scheduled" ? "정기 생성" : "수동 생성"}</div>
                                    <div>버전: v{s.generationVersion || 1}</div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
