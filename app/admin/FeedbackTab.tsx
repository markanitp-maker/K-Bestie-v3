"use client";

import React, { useState, useEffect, useCallback } from "react";

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

export default function FeedbackTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    if (status) query.set("status", status);
    if (role) query.set("role", role);
    if (search) query.set("search", search);

    fetch(`/api/admin/support-requests?${query.toString()}`)
      .then((r) => r.json())
      .then((d) => setRequests(d.requests || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [category, status, role, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpdate = async (id: string, newStatus: string, newNote: string) => {
    try {
      const res = await fetch(`/api/admin/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, admin_note: newNote }),
      });
      if (res.ok) {
        alert("저장되었습니다.");
        load();
      } else {
        const d = await res.json();
        alert(d.error || "저장 실패");
      }
    } catch (e) {
      alert("오류 발생");
    }
  };

  const getCategoryLabel = (c: string) => {
    if (c === "voc") return "문의";
    if (c === "feature") return "건의";
    if (c === "bug") return "버그";
    return c;
  };

  const getStatusLabel = (s: string) => {
    if (s === "open" || s === "received") return "접수됨";
    if (s === "in_progress" || s === "reviewing") return "확인 중";
    if (s === "resolved") return "처리 완료";
    if (s === "closed") return "종료";
    return s;
  };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-k-text-primary)", margin: "24px 0 10px" }}>
        문의·건의·버그 접수 목록
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13 }}>
          <option value="">모든 유형</option>
          <option value="voc">문의</option>
          <option value="feature">건의</option>
          <option value="bug">버그</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13 }}>
          <option value="">모든 상태</option>
          <option value="open">접수됨 (open)</option>
          <option value="in_progress">확인 중 (in_progress)</option>
          <option value="resolved">처리 완료 (resolved)</option>
          <option value="closed">종료 (closed)</option>
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13 }}>
          <option value="">모든 접수자</option>
          <option value="child">아이</option>
          <option value="parent">부모</option>
        </select>
        <input
          type="text"
          placeholder="검색어 (접수번호, 내용)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13, minWidth: 200 }}
        />
      </div>

      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-k-text-secondary)", fontSize: 13 }}>불러오는 중...</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-k-text-secondary)", fontSize: 13 }}>조건에 맞는 접수가 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--color-k-background)", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>접수번호</th>
                <th style={thStyle}>유형</th>
                <th style={thStyle}>접수자</th>
                <th style={thStyle}>제목/내용 요약</th>
                <th style={thStyle}>접수일</th>
                <th style={thStyle}>상태</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <React.Fragment key={req.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    style={{ cursor: "pointer", background: expandedId === req.id ? "var(--color-k-navy-tint)" : undefined }}
                  >
                    <td style={tdStyle}>{req.request_number || "-"}</td>
                    <td style={tdStyle}>{getCategoryLabel(req.category)}</td>
                    <td style={tdStyle}>{req.submitter_role === "child" ? "아이" : "부모"}</td>
                    <td style={tdStyle}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                        {req.category === "voc" ? req.body : req.subject}
                      </div>
                    </td>
                    <td style={tdStyle}>{formatDateTime(req.created_at)}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: "2px 6px", borderRadius: 4, background: req.status === "open" ? "#fef3c7" : "#e0e7ff", fontSize: 11 }}>
                        {getStatusLabel(req.status)}
                      </span>
                    </td>
                  </tr>
                  {expandedId === req.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, borderBottom: "1px solid var(--color-k-border)" }}>
                        <div style={{ padding: 16, background: "var(--color-k-navy-tint)", borderRadius: 12, margin: "0 0 12px", animation: "hbAccordionIn 0.18s ease" }}>
                          <FeedbackDetail req={req} onUpdate={(status, note) => handleUpdate(req.id, status, note)} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FeedbackDetail({ req, onUpdate }: { req: any; onUpdate: (status: string, note: string) => void }) {
  const [status, setStatus] = useState(req.status || "open");
  const [note, setNote] = useState(req.admin_note || "");

  return (
    <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--color-k-text-primary)" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div><b>접수 화면:</b> {req.current_route || "-"}</div>
        <div><b>환경:</b> {req.environment || "-"} / <b>앱 버전:</b> {req.app_version || "-"}</div>
        <div><b>기기 정보:</b> {req.device_info ? JSON.stringify(req.device_info) : "-"}</div>
        <div><b>접수자 ID:</b> {req.user_id}</div>
        <div><b>아이 ID:</b> {req.child_id || "없음"}</div>
        <div><b>보호자 ID:</b> {req.guardian_id || "없음"}</div>
        
        <div style={{ marginTop: 8, padding: 12, background: "white", borderRadius: 8, border: "1px solid var(--color-k-border)" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>제목: {req.subject}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{req.body}</div>
        </div>
      </div>
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>상태 변경</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13 }}>
            <option value="open">접수됨 (open)</option>
            <option value="in_progress">확인 중 (in_progress)</option>
            <option value="resolved">처리 완료 (resolved)</option>
            <option value="closed">종료 (closed)</option>
          </select>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>관리자 메모</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%", height: 100, padding: "8px", borderRadius: 8, border: "1px solid var(--color-k-border)", fontSize: 13, resize: "none" }}
            placeholder="내부 처리 메모를 남기세요."
          />
        </div>
        <button
          onClick={() => onUpdate(status, note)}
          style={{ width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "var(--color-k-navy)", color: "white", fontWeight: 700, cursor: "pointer" }}
        >
          저장하기
        </button>
      </div>
    </div>
  );
}
