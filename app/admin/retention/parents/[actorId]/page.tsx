"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import html2canvas from "html2canvas";

export default function ParentDetailPage({ params }: { params: Promise<{ actorId: string }> }) {
  const { actorId } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    fetch(`/api/admin/retention/parents/${actorId}`)
      .then(res => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [actorId]);

  const handlePng = async () => {
    const el = document.getElementById("export-area");
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2 });
    const link = document.createElement("a");
    link.download = `parent_${actorId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>로딩중...</div>;
  if (error) return <div style={{ padding: 40, color: "red" }}>오류: {error}</div>;
  if (!data) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--hb-bg, #fafaf8)", paddingBottom: 64 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      
      <header className="no-print" style={{ background: "var(--hb-card)", padding: "16px 20px", borderBottom: "1px solid var(--hb-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/admin/retention" style={{ fontSize: 13, color: "var(--hb-primary)", textDecoration: "none" }}>← 리텐션 개요로 돌아가기</Link>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1e1e2d" }}>부모 상세 내역</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={btnStyle}>PDF로 내보내기</button>
          <button onClick={handlePng} style={btnStyle}>PNG로 저장</button>
        </div>
      </header>

      <main id="export-area" style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px", background: "var(--hb-bg, #fafaf8)" }}>
        <div style={{ background: "var(--hb-card)", padding: 24, borderRadius: 16, boxShadow: "var(--hb-shadow)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 16px 0", color: "#1e1e2d" }}>부모 정보 ({actorId})</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 14, color: "#1e1e2d" }}>
            <div><strong>소속 가족 ID:</strong> <Link href={`/admin/retention/families/${data.familyId}`} className="no-print" style={linkStyle}>{data.familyId}</Link></div>
            <div><strong>연결된 아이 수:</strong> {data.connectedChildren.length}명</div>
            <div><strong>가입일:</strong> {data.joinedAt ? new Date(data.joinedAt).toLocaleString() : "알 수 없음"}</div>
            <div><strong>마지막 로그인:</strong> {data.lastLoginAt ? new Date(data.lastLoginAt).toLocaleString() : "없음"}</div>
            <div><strong>마지막 의미 행동:</strong> {data.lastMeaningfulActionAt ? new Date(data.lastMeaningfulActionAt).toLocaleString() : "없음"}</div>
            <div><strong>총 활성 일수:</strong> {data.activeDaysTotal}일</div>
            <div><strong>최근 7일 활성:</strong> {data.activeDaysLast7}일</div>
            <div><strong>최근 30일 활성:</strong> {data.activeDaysLast30}일</div>
            <div><strong>평균 주간 방문:</strong> {data.avgWeeklyVisits}회</div>
          </div>
        </div>

        <div style={{ background: "var(--hb-card)", padding: 24, borderRadius: 16, boxShadow: "var(--hb-shadow)", marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, margin: "0 0 12px 0", color: "#1e1e2d" }}>기능 사용 통계</h3>
          <div style={{ display: "flex", gap: 24, fontSize: 14, color: "var(--hb-muted)" }}>
            {Object.entries(data.featureUsage).map(([k, v]) => (
              <div key={k}><strong>{k}:</strong> {v as number}회</div>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--hb-card)", padding: 24, borderRadius: 16, boxShadow: "var(--hb-shadow)" }}>
          <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "#1e1e2d" }}>타임라인 (최근 200건)</h3>
          <div style={{ maxHeight: 400, overflowY: "auto", fontSize: 13 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--hb-primary-light)" }}>
                <tr>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--hb-border)", color: "var(--hb-muted)" }}>시간</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--hb-border)", color: "var(--hb-muted)" }}>이벤트</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--hb-border)", color: "var(--hb-muted)" }}>기능</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--hb-border)", color: "var(--hb-muted)" }}>대상 아이 ID</th>
                </tr>
              </thead>
              <tbody>
                {data.timeline.map((e: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--hb-border)" }}>
                    <td style={{ padding: "8px 12px", color: "#1e1e2d" }}>{new Date(e.occurredAt).toLocaleString()}</td>
                    <td style={{ padding: "8px 12px", color: "#1e1e2d" }}>{e.eventName}</td>
                    <td style={{ padding: "8px 12px", color: "var(--hb-muted)" }}>{e.feature}</td>
                    <td style={{ padding: "8px 12px", color: "var(--hb-muted)" }}>{e.childId ? (e.childId.split("-")[0] + "...") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

const btnStyle = { padding: "8px 16px", borderRadius: 8, background: "#1e1e2d", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" };
const linkStyle = { color: "var(--hb-primary)", textDecoration: "none", fontWeight: 600 };
