"use client";

import { useState, useEffect, useCallback } from "react";

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
  const [forceRegenerate, setForceRegenerate] = useState(false);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

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

    try {
      const target = scope === "single"
        ? { scope: "single", childId: selectedChildId }
        : { scope: "all", forceRegenerate };

      const res = await fetch("/api/admin/reporting/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDate: date, action, target })
      });

      const data = await res.json();
      setRunResult(data);

      if (data.ok) {
        if (scope === "single") loadChildren();
        if (scope === "all") loadSummary();
      }
    } catch (e: any) {
      setRunResult({ ok: false, error: e.message });
    } finally {
      setRunning(false);
    }
  };

  const selectedChild = children.find(c => c.childId === selectedChildId);

  // Production 완전 비노출(서버가 최종 방어선 - /api/admin/reporting/*는 getSupabaseTarget()
  // === 'prod'면 403). 이 체크는 반드시 모든 훅 호출 뒤에 와야 한다 - 훅보다 먼저 있으면
  // React Rules of Hooks 위반(조건부 이른 반환으로 훅이 조건부 호출됨)이다.
  if (process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod") {
    return null;
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", margin: "24px 0 10px" }}>
        리포팅 수동 실행 (베타용)
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
                  <th style={thStyle}>리포트상태</th>
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
                      <td style={tdStyle}>{c.reportExists ? (c.lastReportGeneratedAt ? formatDateTime(c.lastReportGeneratedAt).substring(0, 16) : "O") : "X"}</td>
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

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={forceRegenerate} onChange={e => setForceRegenerate(e.target.checked)} />
              강제 재생성 표시 (응답에만 반영)
            </label>
          </div>

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
                    <strong>✅ 성공</strong> (동작: {runResult.action})
                  </div>
                  {runResult.collect && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>[수집(보정)]</strong><br/>
                      - 새로 수집된 턴: {runResult.collect.collected}건<br/>
                      - 상태: 보정 {runResult.collect.corrected}건, 유지 {runResult.collect.unchanged}건, 불확실 {runResult.collect.uncertain}건, 반려 {runResult.collect.rejected}건<br/>
                      {runResult.collect.errors && runResult.collect.errors.length > 0 && (
                        <div style={{ color: "var(--color-k-danger)" }}>- 수집 에러: {runResult.collect.errors.length}건</div>
                      )}
                    </div>
                  )}
                  {runResult.generate && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>[리포트 생성]</strong><br/>
                      - 생성/갱신됨: {runResult.generate.created?.length || 0}건<br/>
                      - 건너뜀(대화없음): {runResult.generate.skipped?.length || 0}건<br/>
                      - 에러: {runResult.generate.errorCount}건<br/>
                      {runResult.generate.errors?.map((e: any, i: number) => (
                        <div key={i} style={{ color: "var(--color-k-danger)", fontSize: 12 }}>- {e.sessionId}: {e.error}</div>
                      ))}
                    </div>
                  )}
                  {runResult.dashboardStatus && runResult.dashboardStatus.length > 0 && (
                    <div>
                      <strong>[생성된 리포트 N/8 상태]</strong><br/>
                      {runResult.dashboardStatus.map((s: any, i: number) => (
                        <div key={i}>- 아이 {s.childId}: {s.nonNullFieldCount}/8 항목 작성됨</div>
                      ))}
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
