"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import html2canvas from "html2canvas";
import { AdminDataTable } from "@/components/admin/shell/AdminDataTable";

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
    <div style={{ minHeight: "100vh", background: "var(--admin-bg)", paddingBottom: 64 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      
      <header className="no-print" style={{ background: "var(--admin-surface)", padding: "16px 20px", borderBottom: "1px solid var(--admin-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/admin/retention" style={{ fontSize: 13, color: "var(--admin-primary)", textDecoration: "none" }}>← 리텐션 개요로 돌아가기</Link>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--admin-text-primary)" }}>아이 상세 내역</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={btnStyle}>PDF로 내보내기</button>
          <button onClick={handlePng} style={btnStyle}>PNG로 저장</button>
        </div>
      </header>

      <main id="export-area" style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 20px", background: "var(--admin-bg)" }}>
        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 16px 0", color: "var(--admin-text-primary)" }}>아이 정보 ({childId})</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 14, color: "var(--admin-text-primary)" }}>
            <div><strong>소속 가족 ID:</strong> <Link href={`/admin/retention/families/${data.familyId}`} className="no-print" style={linkStyle}>{data.familyId}</Link></div>
            <div><strong>학년:</strong> {data.grade}</div>
            <div><strong>최초 의미 행동:</strong> {data.firstMeaningfulUseAt ? new Date(data.firstMeaningfulUseAt).toLocaleString() : "없음"}</div>
            <div><strong>마지막 접속:</strong> {data.lastVisitAt ? new Date(data.lastVisitAt).toLocaleString() : "없음"}</div>
            <div><strong>총 접속 횟수:</strong> {data.totalVisits}회</div>
            <div><strong>연속 접속:</strong> {data.streakDays}일</div>
          </div>
        </div>

        {data.integrityViolations && data.integrityViolations.length > 0 && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", padding: 16, borderRadius: 12, marginBottom: 24, color: "#991B1B", fontSize: 13 }}>
            <strong>⚠ 정합성 위반 감지</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {data.integrityViolations.map((v: string) => <li key={v}>{v}</li>)}
            </ul>
          </div>
        )}

        {/* 활성 일수와 미션/자유대화/놀이 수를 같은 기간(최근 7일, 최근 30일) 기준으로
            나란히 보여준다 — 예전엔 활성 일수만 기간별로 나뉘고 미션 수는 기간 필터 없이
            전체 누적을 보여줘서 서로 다른 분모를 비교하는 것처럼 보였다. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "var(--admin-surface)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--admin-text-primary)" }}>최근 7일</h3>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>활성 일수: <strong>{data.activeDaysLast7}일</strong></div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>미션 수: <strong>{data.mission.last7}회</strong> (하루 최대 2회, child_id+business_date+mission_type 기준 dedupe)</div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>자유대화: {data.freechat.last7}회 · 놀이: {data.play.last7}회</div>
          </div>
          <div style={{ background: "var(--admin-surface)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--admin-text-primary)" }}>최근 30일</h3>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>활성 일수: <strong>{data.activeDaysLast30}일</strong></div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>미션 수: <strong>{data.mission.last30}회</strong></div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>자유대화: {data.freechat.last30}회 · 놀이: {data.play.last30}회</div>
          </div>
          <div style={{ background: "var(--admin-surface)", padding: 16, borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px 0", color: "var(--admin-text-primary)" }}>전체 누적</h3>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>미션 수(dedupe): {data.mission.allTime}회 | 완료: {data.mission.completeCount}회</div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)", marginTop: 4 }}>완료율: {data.mission.completionRate ? (data.mission.completionRate * 100).toFixed(1) + "%" : "-"}</div>
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)", marginTop: 4 }}>자유대화: {data.freechat.allTime}회 · 놀이: {data.play.allTime}회</div>
            <div style={{ fontSize: 13, color: "var(--admin-text-secondary)", marginTop: 8 }}>
              {Object.entries(data.play.byType || {}).map(([k, v]) => (
                <span key={k} style={{ marginRight: 8, display: "inline-block", background: "var(--admin-bg)", padding: "2px 6px", borderRadius: 4 }}>{k}: {v as number}회</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)" }}>
          <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--admin-text-primary)" }}>타임라인 (최근 200건)</h3>
          <AdminDataTable
            columns={[
              { key: "time", header: "시간", render: (r: any) => new Date(r.occurredAt).toLocaleString() },
              { key: "event", header: "이벤트", render: (r: any) => r.eventName },
              { key: "feature", header: "기능/모드", render: (r: any) => `${r.feature} ${r.playType ? `(${r.playType})` : ""} ${r.conversationMode ? `[${r.conversationMode}]` : ""}`.trim() }
            ]}
            data={data.timeline}
            keyExtractor={(r: any) => r.occurredAt + r.eventName}
          />
        </div>
      </main>
    </div>
  );
}

const btnStyle = { padding: "8px 16px", borderRadius: 8, background: "var(--admin-text-primary)", color: "var(--admin-surface)", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" };
const linkStyle = { color: "var(--admin-primary)", textDecoration: "none", fontWeight: 600 };
