"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import html2canvas from "html2canvas";

export default function ChildDetailPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    fetch(`/api/admin/retention/children/${childId}`)
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
  }, [childId]);

  const handlePng = async () => {
    const el = document.getElementById("export-area");
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2 });
    const link = document.createElement("a");
    link.download = `child_${childId}.png`;
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
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-k-text-primary)" }}>아이 상세 내역</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={btnStyle}>PDF로 내보내기</button>
          <button onClick={handlePng} style={btnStyle}>PNG로 저장</button>
        </div>
      </header>

      <main id="export-area" style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 20px", background: "var(--color-k-surface, #fafaf8)" }}>
        <div style={{ background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>아이 정보 ({childId})</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 14, color: "var(--color-k-text-primary)" }}>
            <div><strong>소속 가족 ID:</strong> <Link href={`/admin/retention/families/${data.familyId}`} className="no-print" style={linkStyle}>{data.familyId}</Link></div>
            <div><strong>학년:</strong> {data.grade}</div>
            <div><strong>최초 의미 행동:</strong> {data.firstMeaningfulUseAt ? new Date(data.firstMeaningfulUseAt).toLocaleString() : "없음"}</div>
            <div><strong>마지막 접속:</strong> {data.lastVisitAt ? new Date(data.lastVisitAt).toLocaleString() : "없음"}</div>
            <div><strong>총 접속 횟수:</strong> {data.totalVisits}회</div>
            <div><strong>연속 접속:</strong> {data.streakDays}일</div>
            <div><strong>최근 7일 활성:</strong> {data.activeDaysLast7}일</div>
            <div><strong>최근 30일 활성:</strong> {data.activeDaysLast30}일</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "var(--color-k-background)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--color-k-text-primary)" }}>미션 활동</h3>
            <div style={{ fontSize: 14, color: "var(--color-k-text-secondary)" }}>시작: {data.mission.startCount}회 | 완료: {data.mission.completeCount}회</div>
            <div style={{ fontSize: 14, color: "var(--color-k-text-secondary)", marginTop: 4 }}>완료율: {data.mission.completionRate ? (data.mission.completionRate * 100).toFixed(1) + "%" : "-"}</div>
          </div>
          <div style={{ background: "var(--color-k-background)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--color-k-text-primary)" }}>자유 대화</h3>
            <div style={{ fontSize: 14, color: "var(--color-k-text-secondary)" }}>시작: {data.freechat.startCount}회 | 완료: {data.freechat.completeCount}회</div>
          </div>
          <div style={{ background: "var(--color-k-background)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--color-k-text-primary)" }}>놀이 활동</h3>
            <div style={{ fontSize: 14, color: "var(--color-k-text-secondary)" }}>시작: {data.play.startCount}회 | 완료: {data.play.completeCount}회</div>
            <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)", marginTop: 8 }}>
              {Object.entries(data.play.byType || {}).map(([k, v]) => (
                <span key={k} style={{ marginRight: 8, display: "inline-block", background: "var(--color-k-surface)", padding: "2px 6px", borderRadius: 4 }}>{k}: {v as number}회</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: "var(--color-k-background)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)" }}>
          <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--color-k-text-primary)" }}>타임라인 (최근 200건)</h3>
          <div style={{ maxHeight: 400, overflowY: "auto", fontSize: 13 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--color-k-navy-tint)" }}>
                <tr>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)", color: "var(--color-k-text-secondary)" }}>시간</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)", color: "var(--color-k-text-secondary)" }}>이벤트</th>
                  <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-k-border)", color: "var(--color-k-text-secondary)" }}>기능/모드</th>
                </tr>
              </thead>
              <tbody>
                {data.timeline.map((e: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--color-k-border)" }}>
                    <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{new Date(e.occurredAt).toLocaleString()}</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-k-text-primary)" }}>{e.eventName}</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-k-text-secondary)" }}>{e.feature} {e.playType ? `(${e.playType})` : ""} {e.conversationMode ? `[${e.conversationMode}]` : ""}</td>
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

const btnStyle = { padding: "8px 16px", borderRadius: 8, background: "var(--color-k-text-primary)", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" };
const linkStyle = { color: "var(--color-k-navy)", textDecoration: "none", fontWeight: 600 };
