"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import html2canvas from "html2canvas";
import { AdminDataTable } from "@/components/admin/shell/AdminDataTable";

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
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--admin-text-primary)" }}>부모 상세 내역</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={btnStyle}>PDF로 내보내기</button>
          <button onClick={handlePng} style={btnStyle}>PNG로 저장</button>
        </div>
      </header>

      <main id="export-area" style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 20px", background: "var(--admin-bg)" }}>
        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 16px 0", color: "var(--admin-text-primary)" }}>부모 정보 ({actorId})</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 14, color: "var(--admin-text-primary)" }}>
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

        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, margin: "0 0 12px 0", color: "var(--admin-text-primary)" }}>회원가입 유입 정보</h3>
          {data.attribution ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, fontSize: 14, color: "var(--admin-text-primary)" }}>
              <div>
                <h4 style={{ fontSize: 13, color: "var(--admin-text-secondary)", marginBottom: 8, marginTop: 0 }}>가입 완료 유입 (Signup Touch)</h4>
                <div style={{ display: "grid", gap: 4 }}>
                  <div><strong>가입 완료 채널:</strong> {data.attribution.signupTouchLink?.channel_name || "미확인"}</div>
                  <div><strong>가입 완료 링크:</strong> {data.attribution.signupTouchLink?.link_id || "-"}</div>
                  <div><strong>가입일 (가입 유입):</strong> {data.attribution.signupTouchAt ? new Date(data.attribution.signupTouchAt).toLocaleString() : "-"}</div>
                  <div><strong>Source / Medium:</strong> {data.attribution.signupTouchLink?.utm_source || "-"} / {data.attribution.signupTouchLink?.utm_medium || "-"}</div>
                  <div><strong>Campaign / Content:</strong> {data.attribution.signupTouchLink?.utm_campaign || "-"} / {data.attribution.signupTouchLink?.utm_content || "-"}</div>
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: 13, color: "var(--admin-text-secondary)", marginBottom: 8, marginTop: 0 }}>최초 유입 (First Touch)</h4>
                <div style={{ display: "grid", gap: 4 }}>
                  <div><strong>최초 유입 채널:</strong> {data.attribution.firstTouchLink?.channel_name || "미확인"}</div>
                  <div><strong>최초 유입 링크:</strong> {data.attribution.firstTouchLink?.link_id || "-"}</div>
                  <div><strong>최초 방문일:</strong> {data.attribution.firstTouchAt ? new Date(data.attribution.firstTouchAt).toLocaleString() : "-"}</div>
                  <div><strong>Source / Medium:</strong> {data.attribution.firstTouchLink?.utm_source || "-"} / {data.attribution.firstTouchLink?.utm_medium || "-"}</div>
                  <div><strong>Campaign / Content:</strong> {data.attribution.firstTouchLink?.utm_campaign || "-"} / {data.attribution.firstTouchLink?.utm_content || "-"}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--admin-text-secondary)" }}>유입 정보 없음 (기존 가입자 또는 직접 유입)</div>
          )}
        </div>

        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)", marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, margin: "0 0 12px 0", color: "var(--admin-text-primary)" }}>기능 사용 통계</h3>
          <div style={{ display: "flex", gap: 24, fontSize: 14, color: "var(--admin-text-secondary)" }}>
            {Object.entries(data.featureUsage).map(([k, v]) => (
              <div key={k}><strong>{k}:</strong> {v as number}회</div>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 16, boxShadow: "var(--shadow-k-card)" }}>
          <h3 style={{ fontSize: 16, margin: "0 0 16px 0", color: "var(--admin-text-primary)" }}>타임라인 (최근 200건)</h3>
          <AdminDataTable
            columns={[
              { key: "time", header: "시간", render: (r: any) => new Date(r.occurredAt).toLocaleString() },
              { key: "event", header: "이벤트", render: (r: any) => r.eventName },
              { key: "feature", header: "기능", render: (r: any) => r.feature },
              { key: "target", header: "대상 아이 ID", render: (r: any) => r.childId ? (r.childId.split("-")[0] + "...") : "-" }
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
