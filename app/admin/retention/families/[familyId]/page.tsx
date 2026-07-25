"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import html2canvas from "html2canvas";

export default function FamilyDetailPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    fetch(`/api/admin/retention/families/${familyId}`)
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
  }, [familyId]);

  const handlePng = async () => {
    const el = document.getElementById("export-area");
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2 });
    const link = document.createElement("a");
    link.download = `family_${familyId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>로딩중...</div>;
  if (error) return <div style={{ padding: 40, color: "red" }}>오류: {error}</div>;
  if (!data) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-k-surface, #fafaf8)", paddingBottom: 64 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      
      <header className="no-print" style={{ background: "var(--color-k-background)", padding: "16px 20px", borderBottom: "1px solid var(--color-k-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/admin/retention" style={{ fontSize: 13, color: "var(--color-k-navy)", textDecoration: "none" }}>← 리텐션 개요로 돌아가기</Link>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-k-text-primary)" }}>가족 상세 내역</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={btnStyle}>PDF로 내보내기</button>
          <button onClick={handlePng} style={btnStyle}>PNG로 저장</button>
        </div>
      </header>

      <main id="export-area" style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px", background: "var(--color-k-surface, #fafaf8)" }}>
        <div style={{ background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>가족 정보 ({familyId})</h2>
          <div style={{ fontSize: 14, color: "var(--color-k-text-secondary)" }}>생성일: {new Date(data.createdAt).toLocaleString()}</div>
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>부모 목록 ({data.parents.length}명)</h3>
            {data.parents.map((p: any) => (
              <div key={p.actorId} style={{ padding: 12, border: "1px solid var(--color-k-border)", borderRadius: 8, marginBottom: 8 }}>
                <Link href={`/admin/retention/parents/${p.actorId}`} className="no-print" style={linkStyle}>{p.actorId}</Link>
                <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)", marginTop: 4 }}>
                  가입: {new Date(p.joinedAt).toLocaleDateString()} <br/>
                  리포트 조회: {p.reportViewCount}회 | 토픽 조회: {p.topicViewCount}회<br/>
                  최근 활동: {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleString() : "없음"}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 300, background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>아이 목록 ({data.children.length}명)</h3>
            {data.children.map((c: any) => (
              <div key={c.childId} style={{ padding: 12, border: "1px solid var(--color-k-border)", borderRadius: 8, marginBottom: 8 }}>
                <Link href={`/admin/retention/children/${c.childId}`} className="no-print" style={linkStyle}>{c.childId}</Link>
                <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)", marginTop: 4 }}>
                  학년: {c.grade}<br/>
                  활동: 미션 {c.missionCount}회, 대화 {c.freechatCount}회, 놀이 {c.playCount}회<br/>
                  최근 활동: {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString() : "없음"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginTop: 24 }}>
          <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>커넥션 퍼널 (최근 30일)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--color-k-navy-tint)", color: "var(--color-k-text-secondary)" }}>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)" }}>아이 ID</th>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)" }}>마지막 미션완료</th>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)" }}>리포트 생성</th>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)" }}>부모가 조회</th>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)" }}>토픽 확인</th>
              </tr>
            </thead>
            <tbody>
              {data.connectionFunnel.map((f: any) => (
                <tr key={f.childId} style={{ borderBottom: "1px solid var(--color-k-border)" }}>
                  <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{f.childId.split("-")[0]}...</td>
                  <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{f.missionCompletedAt ? "✅" : "-"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{f.reportGeneratedAt ? "✅" : "-"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{f.reportViewedAt ? "✅" : "-"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{f.topicViewedAfter ? "✅" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

const btnStyle = { padding: "8px 16px", borderRadius: 8, background: "var(--color-k-text-primary)", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" };
const linkStyle = { color: "var(--color-k-navy)", textDecoration: "none", fontWeight: 600 };
