"use client";

import { useEffect, useState, useRef } from "react";

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--hb-muted)",
  borderBottom: "1px solid var(--hb-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "#1e1e2d",
  borderBottom: "1px solid var(--hb-border)",
  verticalAlign: "top",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

type TabKind = "sessions" | "bugs" | "support";

export default function AdminPlaysPage() {
  const [tab, setTab] = useState<TabKind>("sessions");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [playType, setPlayType] = useState("");
  const [status, setStatus] = useState("");
  const [childId, setChildId] = useState("");
  const [sessionId, setSessionId] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    const params = new URLSearchParams({ kind: tab });
    if (playType) params.set("play_type", playType);
    if (status) params.set("status", status);
    if (childId) params.set("child_id", childId);
    if (sessionId) params.set("session_id", sessionId);

    fetch(`/api/admin/plays?${params.toString()}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        setData(d.data || []);
        setLoading(false);
      })
      .catch(e => {
        if (e.name !== "AbortError") {
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    loadData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [tab]);

  const handleRefund = async (sessionId: string, bugReportId?: string) => {
    if (!confirm("이 세션에 대해 황금열쇠를 수동으로 환불하시겠습니까? (중복 환불은 방지됩니다)")) return;
    try {
      const res = await fetch("/api/admin/plays/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ play_session_id: sessionId, bug_report_id: bugReportId })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(`환불 성공: ${data.refunded_quantity}개`);
        loadData();
      } else {
        alert(`환불 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (e) {
      alert("오류가 발생했습니다.");
    }
  };

  const handleUpdateBugStatus = async (id: string, newStatus: string) => {
    const note = prompt("관리자 메모를 입력하세요 (선택):");
    try {
      const res = await fetch(`/api/admin/plays/bug-report/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, admin_note: note || undefined })
      });
      if (res.ok) {
        loadData();
      } else {
        alert("업데이트 실패");
      }
    } catch (e) {
      alert("오류가 발생했습니다.");
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 24 }}>케이 놀이 관리자</h1>
      
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {(["sessions", "bugs", "support"] as TabKind[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: tab === t ? "1px solid var(--hb-primary)" : "1px solid var(--hb-border)",
              background: tab === t ? "var(--hb-primary)" : "transparent",
              color: tab === t ? "white" : "var(--hb-muted)",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {t === "sessions" ? "세션" : t === "bugs" ? "버그신고" : "지원문의"}
          </button>
        ))}
      </div>

      <div style={{ background: "var(--hb-card)", padding: 16, borderRadius: 12, marginBottom: 24, display: "flex", gap: 12, flexWrap: "wrap", border: "1px solid var(--hb-border)" }}>
        <input 
          placeholder="Play Type" 
          value={playType} 
          onChange={e => setPlayType(e.target.value)} 
          style={{ padding: "6px 12px", border: "1px solid var(--hb-border)", borderRadius: 6 }} 
        />
        <input 
          placeholder="Status" 
          value={status} 
          onChange={e => setStatus(e.target.value)} 
          style={{ padding: "6px 12px", border: "1px solid var(--hb-border)", borderRadius: 6 }} 
        />
        <input 
          placeholder="Child ID" 
          value={childId} 
          onChange={e => setChildId(e.target.value)} 
          style={{ padding: "6px 12px", border: "1px solid var(--hb-border)", borderRadius: 6 }} 
        />
        <input 
          placeholder="Session ID" 
          value={sessionId} 
          onChange={e => setSessionId(e.target.value)} 
          style={{ padding: "6px 12px", border: "1px solid var(--hb-border)", borderRadius: 6 }} 
        />
        <button 
          onClick={loadData}
          style={{ padding: "6px 16px", background: "var(--hb-primary)", color: "white", borderRadius: 6, fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          검색
        </button>
      </div>

      <div style={{ overflowX: "auto", background: "var(--hb-card)", borderRadius: 12, border: "1px solid var(--hb-border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            {tab === "sessions" && (
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Child ID</th>
                <th style={thStyle}>Play Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created / Expires</th>
                <th style={thStyle}>Actions</th>
              </tr>
            )}
            {tab === "bugs" && (
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Session ID</th>
                <th style={thStyle}>Error Message</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created At</th>
                <th style={thStyle}>Actions</th>
              </tr>
            )}
            {tab === "support" && (
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created At</th>
                <th style={thStyle}>Actions</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: 24 }}>로딩 중...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: 24 }}>데이터가 없습니다.</td></tr>
            ) : data.map((row: any) => (
              <tr key={row.id}>
                {tab === "sessions" && (
                  <>
                    <td style={tdStyle}><span style={{ fontSize: 11, background: "#eee", padding: "2px 4px", borderRadius: 4 }}>{row.id}</span></td>
                    <td style={tdStyle}>{row.child_id}</td>
                    <td style={tdStyle}>{row.play_type}</td>
                    <td style={tdStyle}>{row.status}</td>
                    <td style={tdStyle}>{formatDateTime(row.created_at)}<br/><span style={{ color: "var(--hb-muted)", fontSize: 11 }}>{formatDateTime(row.expires_at)}</span></td>
                    <td style={tdStyle}>
                      <button onClick={() => handleRefund(row.id)} style={{ padding: "4px 8px", fontSize: 11, background: "var(--hb-danger)", color: "white", borderRadius: 4, border: "none", cursor: "pointer" }}>
                        수동 환불
                      </button>
                    </td>
                  </>
                )}
                {tab === "bugs" && (
                  <>
                    <td style={tdStyle}><span style={{ fontSize: 11, background: "#eee", padding: "2px 4px", borderRadius: 4 }}>{row.id}</span></td>
                    <td style={tdStyle}><span style={{ fontSize: 11 }}>{row.play_session_id}</span></td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{row.stage}</div>
                      <div style={{ fontSize: 11, color: "var(--hb-muted)", marginTop: 2 }}>{row.error_message}</div>
                    </td>
                    <td style={tdStyle}>
                      <select 
                        value={row.status} 
                        onChange={e => handleUpdateBugStatus(row.id, e.target.value)}
                        style={{ padding: 4, fontSize: 11, borderRadius: 4 }}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                      {row.manual_refund_done && <div style={{ fontSize: 10, color: "var(--hb-success)", marginTop: 4 }}>환불됨</div>}
                    </td>
                    <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                    <td style={tdStyle}>
                      {row.play_session_id && !row.manual_refund_done && (
                        <button onClick={() => handleRefund(row.play_session_id, row.id)} style={{ padding: "4px 8px", fontSize: 11, background: "var(--hb-primary)", color: "white", borderRadius: 4, border: "none", cursor: "pointer" }}>
                          수동 환불 연동
                        </button>
                      )}
                    </td>
                  </>
                )}
                {tab === "support" && (
                  <>
                    <td style={tdStyle}><span style={{ fontSize: 11, background: "#eee", padding: "2px 4px", borderRadius: 4 }}>{row.id}</span></td>
                    <td style={tdStyle}>{row.category}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{row.subject}</div>
                      <div style={{ fontSize: 11, color: "var(--hb-muted)", marginTop: 2 }}>{row.body}</div>
                    </td>
                    <td style={tdStyle}>{row.status}</td>
                    <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                    <td style={tdStyle}>-</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
